'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchContextGraph, type ContextGraphNodeDto } from '@/lib/context-graph-api';

type ProjectGraphOverlay = {
  id: string;
  project: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  kind: string;
  content: string;
  author?: string;
  source: string;
  createdAt: string;
};

const OVERLAY_KINDS = ['note', 'confirmation', 'correction', 'rejection', 'risk', 'convention'];

export default function ProjectGraphPage() {
  const [nodes, setNodes] = useState<ContextGraphNodeDto[]>([]);
  const [overlays, setOverlays] = useState<ProjectGraphOverlay[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [kind, setKind] = useState('note');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const projectGraphNodes = useMemo(
    () => nodes.filter((node) => node.metadata?.projectGraph === true),
    [nodes],
  );
  const selectedNode = projectGraphNodes.find((node) => node.id === selectedId) ?? projectGraphNodes[0];
  const visibleOverlays = overlays.filter((overlay) => !selectedNode || overlay.targetNodeId === selectedNode.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const graphNodes = await fetchContextGraph(500);
      const filtered = graphNodes.filter((node) => node.metadata?.projectGraph === true);
      setNodes(graphNodes);
      const firstNode = filtered[0];
      if (firstNode && !selectedId) setSelectedId(firstNode.id);
      const response = await fetch('/api/project-graph-overlays?limit=500');
      if (response.ok) {
        const data = await response.json();
        setOverlays(data.overlays || []);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveOverlay = async () => {
    if (!selectedNode || !content.trim()) return;
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch('/api/project-graph-overlays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedNode.project,
          targetNodeId: selectedNode.id,
          kind,
          content: content.trim(),
          author: author.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(`Save failed: ${response.status}`);
      const data = await response.json();
      setOverlays((current) => [data.overlay, ...current]);
      setContent('');
      setStatus('Overlay saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Overlay save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Graph</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review extracted graph facts and attach editable overlays without changing canonical extraction data.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Refresh
        </button>
      </div>

      {loading ? <div className="py-12 text-center text-gray-400">Loading project graph...</div> : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Extracted Nodes</h2>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {projectGraphNodes.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">No project graph nodes indexed yet.</p>
            ) : projectGraphNodes.map((node) => {
              const active = selectedNode?.id === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedId(node.id)}
                  className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                    active ? 'bg-brand-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-gray-900">{node.title}</span>
                    <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {String(node.metadata?.kind ?? 'node')}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-500">{node.id}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            {selectedNode ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedNode.title}</h2>
                    <p className="mt-1 text-xs text-gray-500">{selectedNode.id}</p>
                  </div>
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                    {String(selectedNode.metadata?.provenance ?? 'unknown')}
                  </span>
                </div>
                <p className="mt-4 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  {selectedNode.content}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400">Select a node to review.</p>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-900">Add Overlay</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
                aria-label="Overlay kind"
              >
                {OVERLAY_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
                placeholder="Author"
              />
            </div>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="mt-3 min-h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
              placeholder="Write the note, correction, confirmation, risk, or convention..."
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={saveOverlay}
                disabled={saving || !selectedNode || !content.trim()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Overlay'}
              </button>
              {status ? <span className="text-sm text-gray-500">{status}</span> : null}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Node Overlays</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{visibleOverlays.length}</span>
            </div>
            {visibleOverlays.length === 0 ? (
              <p className="py-6 text-sm text-gray-400">No overlays for this node.</p>
            ) : (
              <div className="space-y-3">
                {visibleOverlays.map((overlay) => (
                  <article key={overlay.id} className="rounded-md border border-gray-100 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded bg-white px-2 py-0.5 font-medium text-gray-800">{overlay.kind}</span>
                      <span>{overlay.source}</span>
                      {overlay.author ? <span>{overlay.author}</span> : null}
                      <span>{new Date(overlay.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{overlay.content}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
