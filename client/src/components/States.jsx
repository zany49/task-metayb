/** Loading, empty and error states, so every screen handles them the same way. */

export function Spinner({ label = 'Loading' }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__ring" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/** Placeholder rows while a table loads. */
export function SkeletonRows({ rows = 6, columns = 6 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="skeleton-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, c) => (
        <td key={c}>
          <span className="skeleton" />
        </td>
      ))}
    </tr>
  ));
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This could not be loaded' }) {
  return (
    <div className="empty empty--error" role="alert">
      <p className="empty__title">{title}</p>
      <p className="empty__text">{error?.message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Inline error message for a form or action. */
export function FormError({ error, children }) {
  if (!error && !children) return null;
  return (
    <div className="form-error" role="alert">
      {children ?? error.message}
    </div>
  );
}
