'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { KnowledgeTypePill, ProjectPill } from '../ui/Pill';
import { useTranslations } from '@/lib/i18n/hooks';

type Result = {
  id: string;
  title: string;
  excerpt: string;
  project?: string;
  type?: string;
};

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!resp.ok) return;
        const data = await resp.json();
        const list: Result[] = (data.results ?? data.entries ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? r.entryId ?? ''),
          title: String(r.title ?? r.name ?? '(untitled)'),
          excerpt: String(r.excerpt ?? r.solution ?? r.summary ?? ''),
          project: typeof r.project === 'string'
            ? r.project
            : (r.context as Record<string, unknown> | undefined)?.project as string | undefined,
          type: String(r.type ?? ''),
        }));
        setResults(list.slice(0, 20));
        setSelected(0);
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 200);
    return () => { ctrl.abort(); clearTimeout(id); };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      else if (e.key === 'Enter' && results[selected]) {
        const r = results[selected];
        if (r.project) {
          router.push(`/p/${encodeURIComponent(r.project)}/knowledge`);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, results, selected, router]);

  if (!open || typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-surface-900/50 backdrop-anim" onClick={onClose} />
      <div className="relative w-[720px] max-w-[calc(100vw-32px)] max-h-[70vh] bg-white rounded-2xl modal-shadow flex flex-col overflow-hidden modal-anim">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-surface-100">
          <Icon icon="lucide:search" className="text-base text-surface-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="flex-1 bg-transparent text-sm font-medium text-surface-900 placeholder-surface-400 outline-none"
          />
          {loading && <Icon icon="lucide:loader-2" className="text-base text-surface-400 animate-spin" />}
          <button onClick={onClose} className="action-btn"><Icon icon="lucide:x" className="text-sm" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-surface-400">
              {query ? t.search.noResults : t.search.typing}
            </div>
          ) : (
            <ul className="py-2">
              {results.map((r, i) => (
                <li
                  key={r.id || i}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => {
                    if (r.project) {
                      router.push(`/p/${encodeURIComponent(r.project)}/knowledge`);
                      onClose();
                    }
                  }}
                  className={`px-4 py-2.5 cursor-pointer flex items-start gap-3 ${
                    i === selected ? 'bg-brand-50' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {r.project && <ProjectPill project={r.project} />}
                      {r.type && <KnowledgeTypePill type={r.type} />}
                    </div>
                    <div className="text-sm font-semibold text-surface-900 truncate">{r.title}</div>
                    {r.excerpt && (
                      <div className="text-xs text-surface-500 line-clamp-2 mt-0.5">{r.excerpt}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-surface-100 flex items-center gap-4 text-[11px] text-surface-400">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 font-mono text-surface-500 bg-white border border-surface-200 rounded">↑↓</kbd>
            move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 font-mono text-surface-500 bg-white border border-surface-200 rounded">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 font-mono text-surface-500 bg-white border border-surface-200 rounded">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
