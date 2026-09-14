// Alert reads (§10).
//
// Neither endpoint decides what "slow" means — that rule lives once, in
// backend/src/alerts/predicate.js, and both answer with it already applied. Nothing in the
// frontend compares a timestamp against a threshold.

import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client.js';

// 45 seconds, which is what backend/src/alerts/routes.js assumed when it split /alerts/count
// out of /alerts: every open tab polls this, and it returns one integer. Polling the full list
// this often would spend most of a free tier's request budget on a number in a nav badge.
const POLL_MS = 45_000;

export function useAlertCount() {
  return useQuery({
    queryKey: ['alerts', 'count'],
    queryFn: () => get('/alerts/count').then((r) => r.count),
    refetchInterval: POLL_MS,

    // Keep polling in a background tab. A waiter with the board open on a second screen is the
    // case this badge exists for, and that tab is by definition not focused.
    refetchIntervalInBackground: true,

    // The badge is decoration until it is right. A failed poll should not paint an error over
    // the whole nav bar, so the previous count simply stays.
    retry: false,
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts', 'list'],
    queryFn: () => get('/alerts'),

    // minutesOpen is computed by Postgres at query time, so it ages the moment it arrives. A
    // minute is short enough that "82m" is never meaningfully wrong on screen.
    refetchInterval: 60_000,
  });
}
