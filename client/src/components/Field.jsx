import { useId } from 'react';

/**
 * Label + control + hint + error, wired together for screen readers.
 * The control is a render function that receives the id and aria props:
 *
 *   <Field label="Load" error={errors.load}>
 *     {(props) => <input {...props} type="number" />}
 *   </Field>
 */
export default function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field ${error ? 'field--invalid' : ''} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A group of checkboxes or radios with a legend (e.g. zones, priority). */
export function FieldSet({ legend, hint, error, children, className = '' }) {
  const id = useId();
  return (
    <fieldset className={`field fieldset ${error ? 'field--invalid' : ''} ${className}`} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="field__label">{legend}</legend>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
