'use client';

import { Icon } from './Icon';

type Props = {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
};

export function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null;
  const range: (number | '…')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) range.push(i);
    else if (range[range.length - 1] !== '…') range.push('…');
  }
  return (
    <div className="flex items-center justify-center gap-1.5 mt-6">
      <button
        type="button"
        className="action-btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <Icon icon="lucide:chevron-left" />
      </button>
      {range.map((r, i) =>
        r === '…' ? (
          <span key={`e${i}`} className="px-2 text-surface-400 text-sm">…</span>
        ) : (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={`min-w-[32px] h-8 px-2 rounded-lg text-sm font-semibold transition-all ${
              r === page ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-surface-100'
            }`}
          >
            {r}
          </button>
        ),
      )}
      <button
        type="button"
        className="action-btn"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        <Icon icon="lucide:chevron-right" />
      </button>
    </div>
  );
}
