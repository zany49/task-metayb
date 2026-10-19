import { useEffect, useState } from 'react';
import Field from './Field.jsx';
import Modal from './Modal.jsx';
import { FormError } from './States.jsx';

/**
 * A confirmation dialog that asks for a short reason (decline, take back, override, ...).
 * `onConfirm(reason)` should return a promise; the dialog stays open and shows the error if it fails.
 */
export default function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  label = 'Reason',
  placeholder,
  confirmLabel,
  pendingLabel = 'Saving…',
  danger = false,
  minLength = 3,
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fieldError = error?.code === 'VALIDATION_ERROR' ? error.details?.[0]?.message : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="button button--quiet" onClick={onClose}>
            Back
          </button>
          <button
            type="submit"
            form="reason-form"
            className={`button ${danger ? 'button--danger' : 'button--primary'}`}
            disabled={pending || reason.trim().length < minLength}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </>
      }
    >
      <form id="reason-form" className="stack" onSubmit={submit}>
        {description && <p>{description}</p>}
        <Field label={label} error={fieldError}>
          {(props) => (
            <textarea
              {...props}
              className="input"
              rows={3}
              maxLength={300}
              placeholder={placeholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        {error && !fieldError && <FormError error={error} />}
      </form>
    </Modal>
  );
}
