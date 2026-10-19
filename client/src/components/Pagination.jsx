export default function Pagination({ page, limit, total, totalPages, onPageChange }) {
  if (!total) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav className="pagination" aria-label="Pages">
      <span className="pagination__info">
        {first}–{last} of {total}
      </span>
      <span className="pagination__buttons">
        <button type="button" className="button button--quiet" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </span>
    </nav>
  );
}
