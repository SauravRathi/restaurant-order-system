// Formatting. Everything here turns an API value into something to read, and nothing here
// computes one.

/**
 * Money, from the string the API sent.
 *
 * Grouped by hand rather than through Intl.NumberFormat, which would mean Number(value) first.
 * `Number("68880.00")` is exact and would in fact be fine — every rupee value this app will
 * ever show is far inside 2^53 — but the rule this codebase runs on is that money never
 * becomes a float, and "it happens to be safe here" is a rule that needs re-checking at every
 * call site. Splitting the string does not.
 *
 * src/db.js pins NUMERIC to a string so the value survives Postgres → JSON → here intact; this
 * is the last three feet of that.
 */
export function money(value) {
  if (value === null || value === undefined) return '—';

  const [whole, fraction = '00'] = String(value).split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;

  // Indian digit grouping: the last three, then twos. 68880 → 68,880 and 1234567 → 12,34,567.
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;

  return `${negative ? '-' : ''}₹${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/**
 * Money as a number, for Recharts only.
 *
 * The chart library measures pixels, so a value has to become a number somewhere. Confining
 * that to one named function means there is exactly one place to point at when asked where the
 * float conversion happens, and it is not on a bill.
 */
export const moneyToNumber = (value) => Number(value ?? 0);

const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** A clock time — for things that happened today, where the date is noise. */
export const time = (iso) => (iso ? TIME.format(new Date(iso)) : '—');

/** Date and time, for a timeline where "which day" is part of the answer. */
export const dateTime = (iso) => (iso ? DATE_TIME.format(new Date(iso)) : '—');

/** A bare date, for chart axis labels. Takes YYYY-MM-DD as well as a full ISO string. */
export const shortDate = (value) => (value ? DATE.format(new Date(value)) : '—');

/**
 * "48m", "2h 15m", "12d 4h". Used on the board, where how long a table has been waiting is the
 * story, and in the alert badge.
 *
 * The rollover to days matters more than it looks. The seed backdates thirteen days of finished
 * service so §8's fourteen-day chart has something to plot, and without this a served order from
 * last week read as "292h 7m ago" — a number nobody can convert in their head, and one that
 * makes correct data look like broken data.
 *
 * Minutes are dropped once we are past a day: the difference between 12d 4h and 12d 4h 30m is
 * not something anyone reads a board to learn.
 */
export function duration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.max(0, Math.round(minutes));

  if (m < 60) return `${m}m`;

  const hours = Math.floor(m / 60);
  if (hours < 24) {
    const rest = m % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** Minutes since an ISO timestamp. The only arithmetic in this file, and it is on clocks. */
export const minutesSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : null);

// The six statuses, spelled for a human. The set comes from the API — this only capitalises it,
// and deliberately holds no opinion about which may follow which: `allowedNextStatuses` on
// every order is the server's answer to that, and a second copy here is the thing the backend
// went out of its way to make unnecessary.
export const STATUS_LABEL = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

export const statusLabel = (status) => STATUS_LABEL[status] ?? status;
