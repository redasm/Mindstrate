'use client';

import { useCallback, useEffect, useState } from 'react';

type GraphKnowledgeView = {
  id: string;
  title: string;
  summary: string;
  substrateType: string;
  domainType: string;
  project?: string;
  priorityScore: number;
  status: string;
  tags: string[];
};

export default function GraphKnowledgePage() {
  const [entries, setEntries] = useState<GraphKnowledgeView[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/graph-knowledge?limit=100');
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ECS Graph Knowledge</h1>
        <p className="text-sm text-gray-500 mt-1">
          High-level graph-native knowledge views derived from rules, patterns, and summaries.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading graph knowledge...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No ECS graph knowledge available yet.</div>
      ) : (
        <div className="grid gap-4">
          {entries.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                  {entry.substrateType}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                  {entry.domainType}
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  priority {entry.priorityScore.toFixed(2)}
                </span>
              </div>

              <h2 className="mt-3 text-lg font-semibold text-gray-900">{entry.title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">{entry.summary}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {entry.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-500">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 text-xs text-gray-400">
                <div>ID: {entry.id}</div>
                {entry.project ? <div>Project: {entry.project}</div> : null}
                <div>Status: {entry.status}</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
