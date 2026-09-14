// §5 + §6. One screen, because the API made them one endpoint: "orders I am on" is a filter
// over the same list as "orders matching this search", not a separate page.
//
// Filter state lives in the URL. That is not decoration — it means the back button steps back
// through filters instead of leaving the board, a filtered view can be sent to someone, and
// returning from an order detail restores exactly the list you left.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ORDER_STATUSES } from './statuses.js';
import { useAlerts } from '../alerts/queries.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorNotice, Loading, StatusBadge } from '../ui/components.jsx';
import { duration, minutesSince, money, statusLabel, time } from '../ui/format.js';
import NewOrderDialog from './NewOrderDialog.jsx';
import { useOrders, useUsers } from './queries.js';

const PAGE_SIZE = 20;

/**
 * The search params, read as the API's own filter object.
 *
 * Only keys the API declares are ever produced here. `GET /orders` is a zod strictObject, so an
 * unknown parameter is a 422 rather than being ignored — which is a good property of the API
 * and a sharp edge for a frontend that builds query strings loosely.
 */
function filtersFrom(params) {
  const filters = {
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
    sort: params.get('sort') ?? 'placedAt',
    order: params.get('order') ?? 'desc',
    scope: params.get('scope') ?? 'all',
  };

  const q = params.get('q');
  if (q) filters.q = q;

  // Repeatable. getAll, because `?status=placed&status=ready` is how the API takes more than
  // one and the client turns an array into exactly that.
  const status = params.getAll('status');
  if (status.length) filters.status = status;

  for (const key of ['waiterId', 'dateFrom', 'dateTo']) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }

  if (params.get('includeArchived') === 'true') filters.includeArchived = 'true';

  return filters;
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const filters = filtersFrom(params);
  const { data, isPending, isFetching, error } = useOrders(filters);
  const { data: users } = useUsers();

  // Which orders the server currently considers alerting (§10). Read from /alerts rather than
  // recomputing "older than 20 minutes" here — the predicate has a repeat window and an
  // acknowledgement rule, and a second copy of it in the frontend would drift from the one the
  // alerts page and the dashboard use.
  const { data: alertData } = useAlerts();
  const alerting = new Set((alertData?.alerts ?? []).map((a) => a.id));

  const [newOrderOpen, setNewOrderOpen] = useState(false);

  /**
   * Change one filter. Any change except paging resets to page 1 — page 7 of a new search is
   * almost always empty, and landing there looks like "no results".
   *
   * useCallback because the search box's debounce effect depends on this function. Rebuilt on
   * every render, it would cancel and restart the 300 ms timer each time the parent re-rendered,
   * and a debounce that keeps restarting is a debounce that can fail to fire.
   */
  const update = useCallback(
    (changes) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
        else if (value !== null && value !== '' && value !== false) next.set(key, String(value));
      }
      if (!('page' in changes)) next.delete('page');

      // replace, not push: typing a search should not put a history entry behind every
      // keystroke's worth of filter state. Back goes back to where you came from.
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  function toggleStatus(status) {
    const current = params.getAll('status');
    update({
      status: current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    });
  }

  /** Clicking the column you are already sorted by flips the direction. */
  const sortBy = (key) =>
    update({ sort: key, order: filters.sort === key && filters.order === 'desc' ? 'asc' : 'desc' });

  const page = data?.page;
  const orders = data?.orders ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>
            {page ? `${page.total} matching` : 'Loading…'}
            {isFetching && !isPending && ' · refreshing'}
          </p>
        </div>
        <button className="primary" onClick={() => setNewOrderOpen(true)}>
          New order
        </button>
      </div>

      <Filters
        params={params}
        filters={filters}
        users={users}
        user={user}
        onUpdate={update}
        onToggleStatus={toggleStatus}
      />

      <ErrorNotice error={error} />

      <div className="card" style={{ marginTop: 16 }}>
        {isPending ? (
          <Loading />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders match">
            Try clearing a filter, or widening the date range.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTh label="Table" sortKey="tableNumber" filters={filters} onSort={sortBy} />
                  <SortableTh label="Status" sortKey="status" filters={filters} onSort={sortBy} />
                  <th>Waiter</th>
                  <th className="right">Items</th>
                  <th className="right">Total</th>
                  <SortableTh label="Placed" sortKey="placedAt" filters={filters} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="clickable"
                    onClick={() => navigate(`/orders/${order.id}`)}
                  >
                    <td>
                      <strong>{order.tableNumber}</strong>
                      {order.archivedAt && <span className="badge archived" style={{ marginLeft: 8 }}>Archived</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <StatusBadge status={order.status} />
                        {alerting.has(order.id) && <span className="badge alert">Slow</span>}
                      </div>
                    </td>
                    <td>
                      {order.primaryWaiter.displayName}
                      {order.collaboratorCount > 0 && (
                        <span className="faint"> +{order.collaboratorCount}</span>
                      )}
                    </td>
                    <td className="right">{order.lineCount}</td>
                    {/* A string, straight from NUMERIC, formatted and never added to. */}
                    <td className="right nowrap">{money(order.total)}</td>
                    <td className="nowrap">
                      {time(order.placedAt)}
                      <span className="faint"> · {duration(minutesSince(order.placedAt))} ago</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page && page.totalPages > 1 && (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <span className="muted">
            Page {page.page} of {page.totalPages}
          </span>
          <span className="row">
            <button disabled={page.page <= 1} onClick={() => update({ page: page.page - 1 })}>
              Previous
            </button>
            {/* totalPages stays correct past the last page — the API runs a count query when a
                page comes back empty, so this button is never wrongly disabled. */}
            <button
              disabled={page.page >= page.totalPages}
              onClick={() => update({ page: page.page + 1 })}
            >
              Next
            </button>
          </span>
        </div>
      )}

      {newOrderOpen && <NewOrderDialog onClose={() => setNewOrderOpen(false)} />}
    </main>
  );
}

function SortableTh({ label, sortKey, filters, onSort }) {
  const active = filters.sort === sortKey;
  return (
    <th>
      <button
        className="ghost small"
        style={{ padding: 0, font: 'inherit', color: 'inherit' }}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active && <span>{filters.order === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function Filters({ params, filters, users, user, onUpdate, onToggleStatus }) {
  // The search box is typed into locally and pushed to the URL on a pause. Without the debounce
  // every keystroke would be a new query key, a new request, and a new entry in history.
  const urlQuery = params.get('q') ?? '';
  const [text, setText] = useState(urlQuery);

  // The box also has to follow the URL the other way — pressing Clear, or going Back, must
  // empty it. That is state derived from a prop that can change, and React's own answer to it
  // is to adjust during render rather than in an effect: an effect would commit a render
  // showing the stale text and then immediately render again, which is the flash the linter's
  // set-state-in-effect warning is about. Doing it here, React re-runs this component before
  // touching the DOM, so the intermediate state is never painted.
  const [syncedTo, setSyncedTo] = useState(urlQuery);
  if (urlQuery !== syncedTo) {
    setSyncedTo(urlQuery);
    setText(urlQuery);
  }

  // The debounce itself stays an effect, correctly: a timer is an external system, and the
  // cleanup cancelling the previous one on each keystroke is what makes it a debounce rather
  // than one request per character.
  useEffect(() => {
    if (text === urlQuery) return;

    const timer = setTimeout(() => onUpdate({ q: text }), 300);
    return () => clearTimeout(timer);
  }, [text, urlQuery, onUpdate]);

  const selected = params.getAll('status');
  const hasFilters = [...params.keys()].some((k) => k !== 'sort' && k !== 'order');

  return (
    <div className="card">
      <div className="card-body filters" style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <input
            type="search"
            placeholder="Search table number…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ maxWidth: 240 }}
          />

          {/* For a waiter these are the same set — everything they can see, they are on — so
              the toggle only narrows anything for a manager. It is still offered to both,
              because hiding it would mean a role-dependent layout for no gain. */}
          <select value={filters.scope} onChange={(e) => onUpdate({ scope: e.target.value })}>
            <option value="all">{user.role === 'manager' ? 'All orders' : 'Everything I can see'}</option>
            <option value="mine">Only mine</option>
          </select>

          <select
            value={params.get('waiterId') ?? ''}
            onChange={(e) => onUpdate({ waiterId: e.target.value })}
          >
            <option value="">Any waiter</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={params.get('dateFrom') ?? ''}
            onChange={(e) => onUpdate({ dateFrom: e.target.value })}
            style={{ width: 'auto' }}
            aria-label="From date"
          />
          <input
            type="date"
            value={params.get('dateTo') ?? ''}
            onChange={(e) => onUpdate({ dateTo: e.target.value })}
            style={{ width: 'auto' }}
            aria-label="To date"
          />

          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={params.get('includeArchived') === 'true'}
              onChange={(e) => onUpdate({ includeArchived: e.target.checked ? 'true' : '' })}
            />
            <span>Include archived</span>
          </label>

          {hasFilters && (
            <button
              className="ghost small"
              onClick={() => onUpdate({ q: '', status: [], waiterId: '', dateFrom: '', dateTo: '', scope: '', includeArchived: '' })}
            >
              Clear
            </button>
          )}
        </div>

        <div className="row" style={{ gap: 6 }}>
          {ORDER_STATUSES.map((status) => {
            const on = selected.includes(status);
            return (
              <button
                key={status}
                className={on ? 'primary small' : 'small'}
                onClick={() => onToggleStatus(status)}
                aria-pressed={on}
              >
                {statusLabel(status)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
