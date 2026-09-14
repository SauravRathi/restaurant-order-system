// Order reads and writes, and the cache rules that go with them.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api/client.js';

// Cache keys in one place. Every key starts with 'orders', which is what makes
// `invalidateQueries({ queryKey: ['orders'] })` mean "every order view is now suspect" in a
// single call — lists, details and timelines together.
export const orderKeys = {
  all: ['orders'],
  lists: ['orders', 'list'],
  list: (filters) => ['orders', 'list', filters],
  detail: (id) => ['orders', 'detail', id],
  timeline: (id) => ['orders', 'timeline', id],
};

export function useOrders(filters) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: ({ signal }) => get('/orders', filters, { signal }),

    // Paging and filtering keep the previous page on screen while the next one loads, instead
    // of collapsing to a spinner and back. The table does not jump, and the pager buttons stay
    // where the cursor already is.
    placeholderData: keepPreviousData,
  });
}

export const useOrder = (id) =>
  useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: () => get(`/orders/${id}`).then((r) => r.order),
    enabled: Boolean(id),
  });

export const useTimeline = (id) =>
  useQuery({
    queryKey: orderKeys.timeline(id),
    queryFn: () => get(`/orders/${id}/timeline`).then((r) => r.timeline),
    enabled: Boolean(id),
  });

/**
 * Every write against one order, sharing one success rule.
 *
 * The API answers each of these with the whole order — lines, collaborators, total, and a
 * freshly derived `allowedNextStatuses` — so the detail cache is written from the response
 * rather than re-fetched. That is one round trip instead of two, and it closes the window
 * where the screen shows the old status because the refetch has not landed yet.
 *
 * The lists are invalidated rather than patched. A status change moves an order between status
 * filters, an archive drops it out of the default view, and a new line changes its total: which
 * of the cached pages that affects is a question the server can answer and this cannot.
 *
 * Alerts too — serving a slow order clears it, and acknowledging one suppresses it for ten
 * minutes. The badge would otherwise keep its stale number until the next 45-second poll.
 */
export function useOrderMutation(orderId, mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (data?.order) queryClient.setQueryData(orderKeys.detail(orderId), data.order);

      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      queryClient.invalidateQueries({ queryKey: orderKeys.timeline(orderId) });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** §2. The one write that has no order to update yet — it creates one. */
export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tableNumber) => post('/orders', { tableNumber }).then((r) => r.order),
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Everyone, for the waiter filter and the collaborator picker. */
export const useUsers = (role) =>
  useQuery({
    queryKey: ['users', role ?? 'all'],
    queryFn: () => get('/users', { role }).then((r) => r.users),

    // Staff lists change when someone is hired, not while the board is open.
    staleTime: 5 * 60_000,
  });

