'use client';

import { getTypeInfo, getStatusInfo, formatDate } from '@/lib/constants';
import { useTranslations, useLocale } from '@/lib/i18n/hooks';
import Link from 'next/link';

interface KnowledgeUnit {
  id: string;
  type: string;
  title: string;
  problem?: string;
  solution: string;
  tags: string[];
  context: { language?: string; framework?: string; project?: string };
  metadata: { author: string; createdAt: string; confidence: number };
  quality: { score: number; upvotes: number; downvotes: number; useCount: number; status: string };
}

export function KnowledgeCard({
  knowledge: k,
  relevance,
  showActions = false,
  onVote,
  onDelete,
}: {
  knowledge: KnowledgeUnit;
  relevance?: number;
  showActions?: boolean;
  onVote?: (id: string, dir: 'up' | 'down') => void;
  onDelete?: (id: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const typeInfo = getTypeInfo(k.type, locale);
  const statusInfo = getStatusInfo(k.quality.status, locale);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <Link href={`/knowledge/${k.id}`} className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 hover:text-brand-600 transition-colors truncate">
            {k.title}
          </h3>
        </Link>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Problem */}
      {k.problem && (
        <p className="text-sm text-red-700 bg-red-50 rounded px-2 py-1 mb-2">
          <span className="font-medium">{t.card.problem}</span> {k.problem}
        </p>
      )}

      {/* Solution */}
      <p className="text-sm text-gray-700 mb-3 line-clamp-3">{k.solution}</p>

      {/* Tags */}
      {k.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {k.tags.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {relevance !== undefined && (
            <span className="text-brand-600 font-medium">
              {(relevance * 100).toFixed(1)}% {t.card.match}
            </span>
          )}
          <span>{t.card.score} {k.quality.score.toFixed(0)}</span>
          <span>{t.card.used} {k.quality.useCount}</span>
          <span>{k.metadata.author}</span>
          <span>{formatDate(k.metadata.createdAt, locale)}</span>
        </div>

        {showActions && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onVote?.(k.id, 'up')}
              className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600 transition-colors"
              title={t.card.upvote}
            >
              +{k.quality.upvotes}
            </button>
            <button
              onClick={() => onVote?.(k.id, 'down')}
              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
              title={t.card.downvote}
            >
              -{k.quality.downvotes}
            </button>
            <button
              onClick={() => onDelete?.(k.id)}
              className="ml-2 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors text-xs"
              title={t.card.deleteTitle}
            >
              {t.card.deleteText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
