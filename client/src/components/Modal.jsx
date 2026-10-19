import { useEffect, useId, useRef } from 'react';

/**
 * Dialog built on the native <dialog> element: focus moves into it, Escape closes it,
 * and the rest of the page cannot be clicked while it is open.
 */
export default function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      {open && (
        <div className="modal__body">
          <div className="modal__head">
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          {children}
          {footer && <div className="modal__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
