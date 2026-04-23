'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTypeInfo, getStatusInfo, formatDate } from '@/lib/constants';
import { useTranslations, useLocale } from '@/lib/i18n/hooks';

export default function KnowledgeDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [knowledge, setKnowledge] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', problem: '', solution: '', tags: '' });

  useEffect(() => {
    fetch(`/api/knowledge/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) return;
        setKnowledge(data);
        setEditForm({
          title: data.title,
          problem: data.problem || '',
          solution: data.solution,
          tags: (data.tags || []).join(', '),
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleVote = async (dir: 'up' | 'down') => {
    const res = await fetch(`/api/knowledge/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: dir === 'up' ? 'upvote' : 'downvote' }),
    });
    if (!res.ok) return;
    const updated = await res.json();
    if (!updated.error) setKnowledge(updated);
  };

  const handleSave = async () => {
    const res = await fetch(`/api/knowledge/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editForm.title,
        problem: editForm.problem || undefined,
        solution: editForm.solution,
        tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      }),
    });
    if (!res.ok) return;
    const updated = await res.json();
    if (!updated.error) {
      setKnowledge(updated);
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t.detail.confirmDelete)) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    router.push('/knowledge');
  };

  if (loading) return <div className="text-center py-12 text-gray-400">{t.detail.loading}</div>;
  if (!knowledge) return <div className="text-center py-12 text-gray-400">{t.detail.notFound}</div>;

  const k = knowledge;
  const typeInfo = getTypeInfo(k.type, locale);
  const statusInfo = getStatusInfo(k.quality.status, locale);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">&larr; {t.detail.back}</button>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              {editing ? t.detail.cancel : t.detail.edit}
            </button>
            <button onClick={handleDelete} className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">
              {t.detail.delete}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <input
              value={editForm.title}
              onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <textarea
              value={editForm.problem}
              onChange={e => setEditForm(f => ({ ...f, problem: e.target.value }))}
              placeholder={t.detail.problemPlaceholder}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <textarea
              value={editForm.solution}
              onChange={e => setEditForm(f => ({ ...f, solution: e.target.value }))}
              placeholder={t.detail.solutionPlaceholder}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              value={editForm.tags}
              onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))}
              placeholder={t.detail.tagsPlaceholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={handleSave} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
              {t.detail.saveChanges}
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-4">{k.title}</h1>
            {k.problem && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-medium text-red-800 mb-1">{t.detail.problem}</p>
                <p className="text-sm text-red-700 whitespace-pre-wrap">{k.problem}</p>
              </div>
            )}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-green-800 mb-1">{t.detail.solution}</p>
              <p className="text-sm text-green-700 whitespace-pre-wrap">{k.solution}</p>
            </div>
          </>
        )}

        {/* Tags */}
        {!editing && k.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {k.tags.map((tag: string) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{tag}</span>
            ))}
          </div>
        )}

        {/* Vote */}
        {!editing && (
          <div className="flex items-center gap-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => handleVote('up')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 text-sm"
            >
              {t.detail.useful} (+{k.quality.upvotes})
            </button>
            <button
              onClick={() => handleVote('down')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm"
            >
              {t.detail.notUseful} (-{k.quality.downvotes})
            </button>
            <span className="text-sm text-gray-400 ml-auto">{t.detail.score}: {k.quality.score.toFixed(0)} | {t.detail.used}: {k.quality.useCount} {t.detail.times}</span>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-900 mb-3 text-sm">{t.detail.metadata}</h2>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-gray-500">{t.detail.id}</span><span className="text-gray-700 font-mono text-xs">{k.id}</span>
          <span className="text-gray-500">{t.detail.author}</span><span className="text-gray-700">{k.metadata.author}</span>
          <span className="text-gray-500">{t.detail.source}</span><span className="text-gray-700">{k.metadata.source}</span>
          <span className="text-gray-500">{t.detail.created}</span><span className="text-gray-700">{formatDate(k.metadata.createdAt, locale)}</span>
          <span className="text-gray-500">{t.detail.updated}</span><span className="text-gray-700">{formatDate(k.metadata.updatedAt, locale)}</span>
          <span className="text-gray-500">{t.detail.confidence}</span><span className="text-gray-700">{(k.metadata.confidence * 100).toFixed(0)}%</span>
          {k.context.language && <><span className="text-gray-500">{t.detail.language}</span><span className="text-gray-700">{k.context.language}</span></>}
          {k.context.framework && <><span className="text-gray-500">{t.detail.framework}</span><span className="text-gray-700">{k.context.framework}</span></>}
          {k.context.project && <><span className="text-gray-500">{t.detail.project}</span><span className="text-gray-700">{k.context.project}</span></>}
          {k.metadata.commitHash && <><span className="text-gray-500">{t.detail.commit}</span><span className="text-gray-700 font-mono text-xs">{k.metadata.commitHash}</span></>}
        </div>
      </div>
    </div>
  );
}
