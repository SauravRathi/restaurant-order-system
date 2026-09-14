// Alert reads (§10).
//
// Two queries, one truth. Neither of them decides what "slow" means — that rule lives once, in
// backend/src/alerts/predicate.js, and both endpoints answer with it already applied. Nothing in
// the frontend compares a timestamp against a threshold.
//
// The two exist because they cost different amounts: /alerts/count returns an integer for the
// nav badge, /alerts returns the rows a page needs. What they must never do is disagree, and
// they did — see the note on useAlerts below.

import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['alerts', 'list'],

    queryFn: async () => {
      const data = await get('/alerts');

      // Feed the badge from the list.
      //
      // The two were drifting visibly: the "Slow" tag comes from this query, which lives in the
      // pages and so refetches whenever you navigate to one, while the badge's query lives in
      // Layout — which never unmounts while you are signed in, so its only triggers are the
      // 45-second tick, a window focus, or a mutation. Tags could therefore be a minute newer
      // than the number beside them.
      //
      // This costs nothing to fix because the list already contains the answer: /alerts and
      // /alerts/count run the same predicate over the same visibility scope, so the number of
      // rows here IS the count. Writing it into the badge's cache means any page showing tags
      // has just refreshed the badge too, and the cheap poll stays for the pages that do not.
      queryClient.setQueryData(['alerts', 'count'], data.alerts.length);

      return data;
    },

    // minutesOpen is computed by Postgres at query time, so it ages the moment it arrives. A
    // minute is short enough that "82m" is never meaningfully wrong on screen.
    refetchInterval: 60_000,
  });
}
