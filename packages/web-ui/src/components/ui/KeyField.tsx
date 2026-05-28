'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Props = {
  value: string;
  /** When true, shows actual value; when false (default), shows mask. */
  initiallyRevealed?: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  className?: string;
};

export function KeyField({ value, initiallyRevealed = false, onCopy, onRegenerate, className = '' }: Props) {
  const [revealed, setRevealed] = useState(initiallyRevealed);

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopy?.();
    } catch { /* ignore */ }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="key-mask truncate">
        {revealed ? value : '•'.repeat(Math.min(12, Math.max(8, value.length / 2)))}
      </span>
      <button type="button" onClick={() => setRevealed((v) => !v)} className="reveal-btn">
        {revealed ? 'Hide' : 'Reveal'}
      </button>
      <button type="button" onClick={copy} className="action-btn" title="Copy">
        <Icon icon="lucide:copy" className="text-sm" />
      </button>
      {onRegenerate && (
        <button type="button" onClick={onRegenerate} className="action-btn" title="Regenerate">
          <Icon icon="lucide:refresh-cw" className="text-sm" />
        </button>
      )}
    </div>
  );
}
