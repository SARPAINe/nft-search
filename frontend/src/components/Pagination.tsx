interface Props {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}

export default function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  return (
    <div className="pager" role="navigation" aria-label="Pagination">
      <button onClick={() => onChange(1)} disabled={page === 1}>« First</button>
      <button onClick={() => onChange(page - 1)} disabled={page === 1}>‹ Prev</button>
      <span className="info">Page {page} of {totalPages}</span>
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}>Next ›</button>
      <button onClick={() => onChange(totalPages)} disabled={page === totalPages}>Last »</button>
    </div>
  );
}
