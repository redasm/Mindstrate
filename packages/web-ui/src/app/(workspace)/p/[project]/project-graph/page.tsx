'use client';

import { useCallback, useEffect, useMemo, useState, use } from 'react';
import { PROJECT_GRAPH_METADATA_KEYS } from '@mindstrate/protocol';
import { fetchContextGraph, type ContextGraphNodeDto } from '@/lib/context-graph-api';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

type ProjectGraphOverlay = {
  id: string;
  project: string;
  targetNodeId?: string;
  kind: string;
  content: string;
  author?: string;
  source: string;
  createdAt: string;
};

const OVERLAY_KINDS = ['note', 'confirmation', 'correction', 'rejection', 'risk', 'convention'];

export default function ProjectGraphPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const tAll = useTranslations();
  const t = tAll.projectGraph;
  const [nodes, setNodes] = useState<ContextGraphNodeDto[]>([]);
  const [overlays, setOverlays] = useState<ProjectGraphOverlay[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState('note');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const projectNodes = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true &&
          (node.project ?? '') === decoded,
      ),
    [nodes, decoded],
  );
  const selectedNode = projectNodes.find((n) => n.id === selectedId) ?? projectNodes[0];
  const visibleOverlays = overlays.filter(
    (o) => o.project === decoded && (!selectedNode || o.targetNodeId === selectedNode.id),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchContextGraph(500);
      setNodes(all);
      const resp = await fetch(`/api/project-graph-overlays?limit=500&project=${encodeURIComponent(decoded)}`);
      if (resp.ok) {
        const data = await resp.json();
        setOverlays(data.overlays || []);
      }
    } finally {
      setLoading(false);
    }
  }, [decoded]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveOverlay = async () => {
    if (!selectedNode || !content.trim()) return;
    setSaving(true);
    setStatus('');
    try {
      const resp = await fetch('/api/project-graph-overlays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: decoded,
          targetNodeId: selectedNode.id,
          kind,
          content: content.trim(),
          author: author.trim() || undefined,
        }),
      });
      if (!resp.ok) throw new Error(`${t.saveFailedPrefix}: ${resp.status}`);
      const data = await resp.json();
      setOverlays((cur) => [data.overlay, ...cur]);
      setContent('');
      setStatus(t.overlaySaved);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.title}</h1>
            <span className="px-2 py-0.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-md border border-brand-100">
              {decoded}
            </span>
          </div>
          <p className="text-sm text-surface-500 font-medium">
            {t.description}
          </p>
        </div>
        <button type="button" onClick={load} className="btn-outline px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5">
          <Icon icon="lucide:refresh-cw" className="text-sm" />
          {t.refresh}
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-surface-400">{t.loading}</div>
      ) : (
        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="bg-white rounded-2xl border border-surface-200 anim-in d2 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-100">
              <h2 className="text-sm font-bold text-surface-800">{t.extractedNodes}</h2>
              <p className="text-xs text-surface-400 mt-0.5">{projectNodes.length} {t.indexed}</p>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              {projectNodes.length === 0 ? (
                <p className="p-4 text-sm text-surface-400">{t.noNodesIndexed}</p>
              ) : (
                projectNodes.map((node) => {
                  const active = selectedNode?.id === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                      className={`block w-full border-b border-surface-100 px-4 py-3 text-left transition-colors ${
                        active ? 'bg-brand-50' : 'hover:bg-surface-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-surface-800">{node.title}</span>
                        <span className="shrink-0 rounded bg-surface-100 px-2 py-0.5 text-[11px] text-surface-500 font-medium">
                          {String(node.metadata?.kind ?? 'node')}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-surface-400 font-mono">{node.id}</div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <div className="space-y-5">
            <section className="bg-white rounded-2xl border border-surface-200 p-5 anim-in d3">
              {selectedNode ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-surface-900">{selectedNode.title}</h2>
                      <p className="mt-1 text-xs text-surface-400 font-mono">{selectedNode.id}</p>
                    </div>
                    <span className="rounded bg-surface-100 px-2 py-1 text-xs text-surface-600 font-medium">
                      {String(selectedNode.metadata?.provenance ?? 'unknown')}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-50 p-3 text-sm text-surface-700">
                    {selectedNode.content}
                  </p>
                </>
              ) : (
                <p className="text-sm text-surface-400">{t.selectNodeReview}</p>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-surface-200 p-5 anim-in d4">
              <h2 className="text-base font-bold text-surface-900 mb-4">{t.addOverlay}</h2>
              <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] mb-3">
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className="px-3 py-2 border border-surface-200 rounded-lg text-sm font-medium text-surface-700 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
                >
                  {OVERLAY_KINDS.map((v) => (
                    <option key={v} value={v}>
                      {t.overlayKind[v] ?? v}
                    </option>
                  ))}
                </select>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder={t.overlayAuthorPlaceholder}
                  className="px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
                />
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t.overlayContentPlaceholder}
                className="w-full min-h-32 px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveOverlay}
                  disabled={saving || !selectedNode || !content.trim()}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  {saving ? t.savingOverlay : t.saveOverlay}
                  {!saving && <Icon icon="lucide:check" className="text-sm" />}
                </button>
                {status && <span className="text-sm text-surface-500">{status}</span>}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-surface-200 p-5 anim-in d5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-surface-900">{t.nodeOverlays}</h2>
                <span className="rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-600 font-medium">
                  {visibleOverlays.length}
                </span>
              </div>
              {visibleOverlays.length === 0 ? (
                <p className="py-6 text-sm text-surface-400">{t.noOverlays}</p>
              ) : (
                <div className="space-y-3">
                  {visibleOverlays.map((o) => (
                    <article key={o.id} className="rounded-lg border border-surface-100 bg-surface-50 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
                        <span className="rounded bg-white px-2 py-0.5 font-semibold text-surface-800">{t.overlayKind[o.kind] ?? o.kind}</span>
                        <span>{o.source}</span>
                        {o.author && <span>{o.author}</span>}
                        <span>{new Date(o.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-surface-700">{o.content}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
