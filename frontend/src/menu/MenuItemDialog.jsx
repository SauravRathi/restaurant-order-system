// Create and edit one menu item. Manager-only, and the server says so too.
//
// One dialog for both because the fields are the same; which it is depends on whether an item
// was passed in. The difference is POST vs PATCH, and that a PATCH sends only what changed —
// an empty PATCH is a 422, because a request that asks for nothing is a client bug and
// answering 200 to it would hide that.

import { useState } from 'react';
import { ApiError } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { useArchiveMenuItem, useCreateMenuItem, useUpdateMenuItem } from './queries.js';

export default function MenuItemDialog({ item, onClose }) {
  const editing = item !== null;

  const [form, setForm] = useState({
    name: item?.name ?? '',
    category: item?.category ?? '',
    // Kept as the string the API sent. Typing into it edits a decimal string and it goes back
    // as one — the value never becomes a Number on the way through this form.
    price: item?.price ?? '',
    isAvailable: item?.isAvailable ?? true,
  });

  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();
  const mutation = editing ? update : create;

  // Archiving is deliberately its own route rather than a field on the PATCH, so that "update
  // this item" never has to also mean "and also retire it". Same split here: its own button.
  const archive = useArchiveMenuItem();

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();

    const payload = editing
      ? // Only what actually changed. Sending every field would work, but it would also mean a
        // concurrent edit by someone else is silently overwritten with values this form loaded
        // minutes ago.
        Object.fromEntries(
          Object.entries(form).filter(([key, value]) => value !== item[key])
        )
      : form;

    if (editing && Object.keys(payload).length === 0) return onClose();

    await mutation
      .mutateAsync(editing ? { id: item.id, ...payload } : payload)
      .then(onClose)
      .catch(() => {});
  }

  const fields =
    mutation.error instanceof ApiError && mutation.error.status === 422
      ? mutation.error.fieldErrors()
      : {};

  return (
    <Modal
      title={editing ? `Edit ${item.name}` : 'New menu item'}
      onClose={onClose}
      footer={
        <>
          {/* Pushed to the left, away from Save. Archiving takes an item off the live menu and
              is not what someone reaching for the confirm button meant to do. */}
          {editing && (
            <button
              className={item.archivedAt ? '' : 'danger'}
              style={{ marginRight: 'auto' }}
              disabled={archive.isPending}
              onClick={() =>
                archive
                  .mutateAsync({ id: item.id, restore: Boolean(item.archivedAt) })
                  .then(onClose)
                  .catch(() => {})
              }
            >
              {archive.isPending && <Spinner />}
              {item.archivedAt ? 'Restore to menu' : 'Archive'}
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={mutation.isPending}>
            {mutation.isPending && <Spinner />}
            {editing ? 'Save changes' : 'Create item'}
          </button>
        </>
      }
    >
      {/* A 409 NAME_TAKEN lands here — two live items may not share a name, case-insensitively.
          Restoring is the one of the two that can collide, since the name was free while the
          item was archived and something live may have taken it since. Not a field error: the
          name is valid, it is just already in use. */}
      <ErrorNotice error={archive.error ?? (Object.keys(fields).length ? null : mutation.error)} />

      <form onSubmit={onSubmit}>
        <Field label="Name" error={fields.name}>
          <input value={form.name} onChange={set('name')} maxLength={120} autoFocus />
        </Field>

        <Field label="Category" error={fields.category} hint="Groups the item in the ordering picker.">
          <input value={form.category} onChange={set('category')} maxLength={60} />
        </Field>

        <Field
          label="Price"
          error={fields.price}
          hint="Up to two decimal places. 320.999 is refused rather than silently rounded to 321."
        >
          <input
            value={form.price}
            onChange={set('price')}
            inputMode="decimal"
            placeholder="320.00"
          />
        </Field>

        <label className="row" style={{ gap: 7 }}>
          <input type="checkbox" checked={form.isAvailable} onChange={set('isAvailable')} />
          <span>Available to order</span>
        </label>

        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
