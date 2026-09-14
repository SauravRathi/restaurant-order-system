// A note. The one action whose change *is* its record — there is no order column for a note,
// so the timeline entry is the whole write, and the API answers with the timeline rather than
// the order.
//
// Allowed in any state, including archived: a note is a remark about what happened, and
// something worth saying can occur after the fact.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, post } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { orderKeys } from './queries.js';

export default function AddNoteDialog({ orderId, onClose }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  // Not useOrderMutation: that one writes `data.order` into the detail cache, and this route
  // does not return an order. It returns `{ timeline }` — the whole history including the new
  // entry — so the timeline cache is written from the response and nothing is re-fetched.
  const addNote = useMutation({
    mutationFn: (body) => post(`/orders/${orderId}/notes`, body),
    onSuccess: (data) => queryClient.setQueryData(orderKeys.timeline(orderId), data.timeline),
  });

  async function onSubmit(e) {
    e.preventDefault();
    await addNote.mutateAsync({ note: note.trim() }).then(onClose).catch(() => {});
  }

  const fields =
    addNote.error instanceof ApiError && addNote.error.status === 422
      ? addNote.error.fieldErrors()
      : {};

  return (
    <Modal
      title="Add a note"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={addNote.isPending || !note.trim()}>
            {addNote.isPending && <Spinner />}
            Add note
          </button>
        </>
      }
    >
      <ErrorNotice error={fields.note ? null : addNote.error} />

      <form onSubmit={onSubmit}>
        <Field
          label="Note"
          error={fields.note}
          hint="Appended to the order's history. It cannot be edited or removed afterwards."
        >
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            autoFocus
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
