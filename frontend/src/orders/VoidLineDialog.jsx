// §4. Voiding a line, which requires a reason.
//
// The reason is required by the database (order_lines_void_shape), by the API's zod schema, and
// by this form. Three checks for one rule is not redundancy — the database one is what makes it
// true, the API one is what turns it into a sentence instead of a constraint name, and this one
// is what stops a waiter submitting a form that was always going to be refused.

import { useState } from 'react';
import { ApiError, post } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { money } from '../ui/format.js';
import { useOrderMutation } from './queries.js';

export default function VoidLineDialog({ order, line, onClose }) {
  const [reason, setReason] = useState('');

  const voidLine = useOrderMutation(order.id, (body) =>
    post(`/orders/${order.id}/lines/${line.id}/void`, body)
  );

  async function onSubmit(e) {
    e.preventDefault();
    await voidLine.mutateAsync({ reason: reason.trim() }).then(onClose).catch(() => {});
  }

  const fields =
    voidLine.error instanceof ApiError && voidLine.error.status === 422
      ? voidLine.error.fieldErrors()
      : {};

  return (
    <Modal
      title="Void this line"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="danger"
            onClick={onSubmit}
            disabled={voidLine.isPending || reason.trim() === ''}
          >
            {voidLine.isPending && <Spinner />}
            Void line
          </button>
        </>
      }
    >
      <ErrorNotice error={fields.reason ? null : voidLine.error} />

      <p className="muted" style={{ marginTop: 0 }}>
        <strong>
          {line.quantity} × {line.itemName}
        </strong>{' '}
        · {money(line.lineTotal)}
      </p>

      <form onSubmit={onSubmit}>
        <Field
          label="Reason"
          error={fields.reason}
          hint="Kept on the line and in the order's history, permanently."
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Sent back — wrong dish"
            autoFocus
          />
        </Field>
        <button type="submit" hidden />
      </form>

      <p className="faint" style={{ marginBottom: 0 }}>
        The line stays on the bill, struck through, and stops counting towards the total. It is
        not deleted.
      </p>
    </Modal>
  );
}
