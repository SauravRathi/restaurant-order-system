// §2. Creating an order is the moment ownership is created: whoever sends this becomes the
// primary waiter, and every later permission question about the order traces back to here.
// Which is why there is no "waiter" field — identity comes from the token, never the body.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { ErrorNotice, Field, Spinner } from '../ui/components.jsx';
import Modal from '../ui/Modal.jsx';
import { useCreateOrder } from './queries.js';

export default function NewOrderDialog({ onClose }) {
  const navigate = useNavigate();
  const create = useCreateOrder();
  const [tableNumber, setTableNumber] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    const order = await create.mutateAsync(tableNumber).catch(() => null);
    if (!order) return; // the error is in create.error, rendered below

    // Straight into the new order — an empty order is not the end of the task, adding the
    // items is, and that is the next screen.
    onClose();
    navigate(`/orders/${order.id}`);
  }

  const fields =
    create.error instanceof ApiError && create.error.status === 422
      ? create.error.fieldErrors()
      : {};

  return (
    <Modal
      title="New order"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={onSubmit}
            disabled={create.isPending || tableNumber.trim() === ''}
          >
            {create.isPending && <Spinner />}
            Create order
          </button>
        </>
      }
    >
      <ErrorNotice error={fields.tableNumber ? null : create.error} />

      <form onSubmit={onSubmit}>
        <Field
          label="Table"
          error={fields.tableNumber}
          hint="Text, not a number — 'T12', 'Patio 3' and 'Bar' are all fine."
        >
          <input
            value={tableNumber}
            onChange={(e) => setTableNumber(e.target.value)}
            maxLength={40}
            autoFocus
          />
        </Field>
        {/* Submit on Enter, without a second visible button next to the one in the footer. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
