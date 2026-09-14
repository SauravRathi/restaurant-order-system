// §5. Adding a collaborator.
//
// This is the one route that widens who can see an order — visibility and actionability are
// the same predicate, so adding someone here is what makes the order appear on their board and
// makes their status buttons work on it.
//
// The client names *another* person as the object of the action. It never names itself as the
// actor: `added_by` comes from the token, which is what makes the timeline entry trustworthy.

import { useState } from 'react';
import { ApiError, post } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { useOrderMutation, useUsers } from './queries.js';

export default function AddCollaboratorDialog({ order, onClose }) {
  // Waiters only — the API answers 422 for a manager, since a manager already sees everything
  // and adding one would be a no-op dressed up as a permission grant.
  const { data: waiters } = useUsers('waiter');
  const [userId, setUserId] = useState('');

  const add = useOrderMutation(order.id, (body) => post(`/orders/${order.id}/collaborators`, body));

  async function onSubmit(e) {
    e.preventDefault();
    await add.mutateAsync({ userId }).then(onClose).catch(() => {});
  }

  const fields = add.error instanceof ApiError && add.error.status === 422 ? add.error.fieldErrors() : {};

  // Ids are strings. `already.has(u.id)` works because both sides are strings all the way from
  // Postgres — comparing against a number here would silently never match.
  const already = new Set([order.primaryWaiter.id, ...order.collaborators.map((c) => c.id)]);
  const available = (waiters ?? []).filter((u) => !already.has(u.id));

  return (
    <Modal
      title="Add a collaborator"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={add.isPending || !userId}>
            {add.isPending && <Spinner />}
            Add
          </button>
        </>
      }
    >
      <ErrorNotice error={fields.userId ? null : add.error} />

      <form onSubmit={onSubmit}>
        <Field
          label="Waiter"
          error={fields.userId}
          hint="They will be able to see this order and act on it."
        >
          <select value={userId} onChange={(e) => setUserId(e.target.value)} autoFocus>
            <option value="">Choose a waiter…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" hidden />
      </form>

      {available.length === 0 && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Every waiter is already on this order.
        </p>
      )}
    </Modal>
  );
}
