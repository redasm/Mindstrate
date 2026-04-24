'use client';

import Link from 'next/link';

interface GraphKnowledgeView {
  id: string;
  title: string;
  summary: string;
  substrateType: string;
  domainType: string;
  project?: string;
  priorityScore: number;
  status: string;
  sourceRef?: string;
  tags: string[];
}

export function KnowledgeCard({
  knowledge: k,
  relevance,
  showActions = false,
  onVote,
  onDelete,
}: {
  knowledge: GraphKnowledgeView;
  relevance?: number;
  showActions?: boolean;
  onVote?: (id: string, dir: 'up' | 'down') => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-2">
        <Link href={`/knowledge/${k.id}`} className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 hover:text-brand-600 transition-colors truncate">
            {k.title}
          </h3>
        </Link>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700">
            {k.substrateType}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {k.status}
          </span>
        </div>
      </div>

      <p className="text-sm text-gray-700 mb-3 line-clamp-3">{k.summary}</p>

      {k.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {k.tags.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          {relevance !== undefined && (
            <span className="text-brand-600 font-medium">{(relevance * 100).toFixed(1)}% match</span>
          )}
          <span>priority {k.priorityScore.toFixed(2)}</span>
          <span>{k.domainType}</span>
          {k.project ? <span>{k.project}</span> : null}
        </div>

        {showActions && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onVote?.(k.id, 'up')}
              className="p-1 rounded hover:bg-green-100 text-gray-400 hover:text-green-600 transition-colors"
              title="Upvote"
            >
              +
            </button>
            <button
              onClick={() => onVote?.(k.id, 'down')}
              className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
              title="Downvote"
            >
              -
            </button>
            <button
              onClick={() => onDelete?.(k.id)}
              className="ml-2 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors text-xs"
              title="Delete"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
