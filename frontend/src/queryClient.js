// The query cache's defaults, in one place.

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not retry anything the API answered deliberately. A 404 means the order is not
      // yours, a 403 means your role cannot do this, a 422 means the payload is wrong — none
      // of those become true on the third attempt, and retrying them just makes an error take
      // three round trips to Mumbai to appear. A 500 or a dropped connection is worth one
      // retry, because those genuinely are transient.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 1,

      // Ten seconds. Long enough that clicking between an order and back does not re-fetch,
      // short enough that a board showing live orders is not lying for long. Anything that
      // must be fresher says so itself — the alert badge sets its own interval.
      staleTime: 10_000,

      // A waiter alt-tabs back to the order board expecting it to be current.
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Never. A write that failed may well have landed — POST /orders is not idempotent, and
      // a retried one would create a second order on the same table.
      retry: false,
    },
  },
});
