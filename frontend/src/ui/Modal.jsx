// A dialog, on the platform's own <dialog> element.
//
// Using <dialog> rather than a div with a high z-index buys focus trapping, Escape to close,
// the top layer, and the backdrop, all from the browser. Everything below is what it does not
// do for free.

import { useEffect, useRef } from 'react';

export default function Modal({ title, onClose, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    // showModal(), not the `open` attribute — only showModal puts the dialog in the top layer
    // and makes the rest of the page inert.
    if (!dialog.open) dialog.showModal();

    // Escape fires 'cancel' and closes the element without React knowing, which would leave the
    // parent still rendering a closed dialog. Forwarding 'close' keeps the two in step whether
    // it was a button or the keyboard that closed it.
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  // A click on the backdrop lands on the dialog element itself, never on its contents — so
  // comparing the target is what distinguishes "outside" from "inside" without a wrapper div.
  const onBackdropClick = (e) => {
    if (e.target === ref.current) ref.current.close();
  };

  return (
    <dialog ref={ref} className="modal" onClick={onBackdropClick}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="ghost small" onClick={() => ref.current.close()} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="modal-body">{children}</div>

      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}
