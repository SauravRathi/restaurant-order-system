// §3. Adding a line copies the item's name and price onto the order and never reads them from
// the menu again.

import { useState } from 'react';
import { ApiError, post } from '../api/client.js';
import { useMenuItems } from '../menu/queries.js';
import { ErrorNotice, Field, Loading, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { money } from '../ui/format.js';
import { useOrderMutation } from './queries.js';

export default function AddLineDialog({ order, onClose }) {
  // Live menu only. An archived item is a 409 (ITEM_ARCHIVED) and an unavailable one is a 409
  // (ITEM_UNAVAILABLE), so neither belongs in a picker — but both rules still live on the
  // server, and the errors below are what happens when something is archived between the menu
  // loading and this form being submitted.
  const { data: menuItems, isPending } = useMenuItems(false);

  const [form, setForm] = useState({ menuItemId: '', quantity: 1, instructions: '' });

  const addLine = useOrderMutation(order.id, (body) => post(`/orders/${order.id}/lines`, body));

  async function onSubmit(e) {
    e.preventDefault();
    await addLine
      .mutateAsync({
        menuItemId: form.menuItemId,
        // The one number in this payload that really is a number — quantity is an integer, and
        // the API's zod schema requires a JSON number, not a string. `money` values stay strings.
        quantity: Number(form.quantity),
        ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      })
      .then(onClose)
      .catch(() => {});
  }

  const fields =
    addLine.error instanceof ApiError && addLine.error.status === 422
      ? addLine.error.fieldErrors()
      : {};

  const selected = (menuItems ?? []).find((m) => m.id === form.menuItemId);

  // Grouped the way the API already sorted them — by category, then name — so the <optgroup>s
  // fall out of the order the rows arrived in rather than needing a second sort.
  const byCategory = (menuItems ?? []).reduce((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <Modal
      title={`Add an item to table ${order.tableNumber}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={addLine.isPending || !form.menuItemId}>
            {addLine.isPending && <Spinner />}
            Add item
          </button>
        </>
      }
    >
      {isPending ? (
        <Loading label="Loading the menu…" />
      ) : (
        <form onSubmit={onSubmit}>
          <ErrorNotice error={Object.keys(fields).length ? null : addLine.error} />

          <Field label="Item" error={fields.menuItemId}>
            <select
              value={form.menuItemId}
              onChange={(e) => setForm((f) => ({ ...f, menuItemId: e.target.value }))}
              autoFocus
            >
              <option value="">Choose an item…</option>
              {Object.entries(byCategory).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((item) => (
                    // Unavailable items are shown but not selectable, rather than hidden: a
                    // waiter looking for "Butter Naan" should find out it is off, not conclude
                    // the restaurant does not sell it.
                    <option key={item.id} value={item.id} disabled={!item.isAvailable}>
                      {item.name} — {money(item.price)}
                      {item.isAvailable ? '' : ' (unavailable)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Quantity" error={fields.quantity}>
            <input
              type="number"
              min={1}
              max={99}
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </Field>

          <Field label="Instructions" error={fields.instructions} hint="Optional — 'no chilli', 'on the side'.">
            <input
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              maxLength={500}
            />
          </Field>

          {selected && (
            <p className="muted" style={{ margin: 0 }}>
              {/* Deliberately not `unitPrice × quantity` — the line total the bill will show is
                  computed by Postgres from the snapshot it takes, and a second calculation here
                  would be a second answer to the same question. This just quotes today's price. */}
              {selected.name} is {money(selected.price)} each today. That price is copied onto
              the order now and will not change if the menu does.
            </p>
          )}

          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
