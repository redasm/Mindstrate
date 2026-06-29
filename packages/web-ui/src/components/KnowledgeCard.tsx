'use client';

import Link from 'next/link';
import { Icon } from './ui/Icon';
import { KnowledgeTypePill } from './ui/Pill';

export interface KnowledgeCardData {
  id: string;
  title: string;
  summary: string;
  substrateType: string;
  domainType?: string;
  project?: string;
  priorityScore?: number;
  status?: string;
  tags?: string[];
  context?: { project?: string; language?: string };
  createdAt?: string;
  updatedAt?: string;
  refCount?: number;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  return `${w}w ago`;
}

export function KnowledgeCard({
  knowledge: k,
  href,
  onDelete,
}: {
  knowledge: KnowledgeCardData;
  href?: string;
  onDelete?: (id: string) => void;
}) {
  const language = k.context?.language;
  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <KnowledgeTypePill type={k.substrateType} />
        {(onDelete || href) && (
          <div className="card-actions flex items-center gap-1">
            <span className="action-btn" title="View details">
              <Icon icon="lucide:expand" className="text-sm" />
            </span>
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(k.id);
                }}
                className="action-btn danger"
                title="Delete"
              >
                <Icon icon="lucide:trash-2" className="text-sm" />
              </button>
            )}
          </div>
        )}
      </div>
      <h3 className="text-sm font-bold text-surface-800 tracking-tight mb-1.5 leading-snug">
        {k.title}
      </h3>
      <p className="text-xs text-surface-500 leading-relaxed mb-3 line-clamp-2">{k.summary}</p>
      <div className="flex items-center gap-3 text-[11px] text-surface-400 font-medium">
        {language && (
          <span className="flex items-center gap-1">
            <Icon icon="lucide:code-2" className="text-xs" />
            {language}
          </span>
        )}
        {k.updatedAt && (
          <span className="flex items-center gap-1">
            <Icon icon="lucide:clock" className="text-xs" />
            {timeAgo(k.updatedAt)}
          </span>
        )}
        {typeof k.refCount === 'number' && (
          <span className="flex items-center gap-1">
            <Icon icon="lucide:eye" className="text-xs" />
            {k.refCount} refs
          </span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card-entry bg-white rounded-xl p-5 block cursor-pointer">
        {inner}
      </Link>
    );
  }
  return <div className="card-entry bg-white rounded-xl p-5">{inner}</div>;
}
