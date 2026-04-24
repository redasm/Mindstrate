'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type GraphKnowledgeView = {
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
};

export default function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<GraphKnowledgeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', summary: '', tags: '' });

  useEffect(() => {
    fetch(`/api/knowledge/${id}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.error) return;
        setView(data);
        setEditForm({
          title: data.title,
          summary: data.summary,
          tags: (data.tags || []).join(', '),
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    const response = await fetch(`/api/knowledge/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editForm.title,
        summary: editForm.summary,
        tags: editForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      }),
    });
    if (!response.ok) return;
    const updated = await response.json();
    if (!updated.error) {
      setView(updated);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this ECS node?')) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    router.push('/knowledge');
  };

  if (loading) return <div className="py-12 text-center text-gray-400">Loading ECS node...</div>;
  if (!view) return <div className="py-12 text-center text-gray-400">ECS node not found.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">&larr; Back</button>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{view.substrateType}</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{view.status}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button onClick={handleDelete} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              Delete
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <input
              value={editForm.title}
              onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <textarea
              value={editForm.summary}
              onChange={(event) => setEditForm((form) => ({ ...form, summary: event.target.value }))}
              rows={8}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              value={editForm.tags}
              onChange={(event) => setEditForm((form) => ({ ...form, tags: event.target.value }))}
              placeholder="tags, separated, by comma"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={handleSave} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Save ECS Node
            </button>
          </div>
        ) : (
          <>
            <h1 className="mb-4 text-xl font-bold text-gray-900">{view.title}</h1>
            <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 p-3">
              <p className="mb-1 text-sm font-medium text-brand-800">Graph Summary</p>
              <p className="whitespace-pre-wrap text-sm text-brand-700">{view.summary}</p>
            </div>
          </>
        )}

        {!editing && view.tags.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {view.tags.map((tag) => (
              <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">ECS Metadata</h2>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-gray-500">Node ID</span><span className="font-mono text-xs text-gray-700">{view.id}</span>
          <span className="text-gray-500">Substrate</span><span className="text-gray-700">{view.substrateType}</span>
          <span className="text-gray-500">Domain</span><span className="text-gray-700">{view.domainType}</span>
          <span className="text-gray-500">Priority</span><span className="text-gray-700">{view.priorityScore.toFixed(2)}</span>
          {view.project ? <><span className="text-gray-500">Project</span><span className="text-gray-700">{view.project}</span></> : null}
          {view.sourceRef ? <><span className="text-gray-500">Source Ref</span><span className="font-mono text-xs text-gray-700">{view.sourceRef}</span></> : null}
        </div>
      </div>
    </div>
  );
}
