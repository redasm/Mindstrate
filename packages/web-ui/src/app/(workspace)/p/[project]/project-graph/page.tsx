'use client';

import { useCallback, useEffect, useMemo, useRef, useState, use } from 'react';
import dynamic from 'next/dynamic';
import { PROJECT_GRAPH_METADATA_KEYS } from '@mindstrate/protocol';
import {
  fetchProjectSubgraph,
  type ContextGraphNodeDto,
  type ContextGraphEdgeDto,
} from '@/lib/context-graph-api';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

// react-force-graph touches `window` at import time, so it must be client-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false }) as any;

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

const NODE_KIND_COLOR: Record<string, string> = {
  project: '#4f46e5',
  directory: '#64748b',
  file: '#6366f1',
  module: '#0ea5e9',
  class: '#7c3aed',
  function: '#0891b2',
  type: '#10b981',
  component: '#ec4899',
  dependency: '#f59e0b',
  config: '#d97706',
  concept: '#16a34a',
};
const DEFAULT_NODE_COLOR = '#94a3b8';
const kindColor = (kind: string): string => NODE_KIND_COLOR[kind] ?? DEFAULT_NODE_COLOR;

type GNode = { id: string; name: string; kind: string; x?: number; y?: number };
type GLink = { id: string; source: string; target: string; kind: string };

const nodeKindOf = (n: ContextGraphNodeDto): string =>
  String(n.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'node');
const edgeKindOf = (e: ContextGraphEdgeDto): string =>
  String(e.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? e.relationType);

export default function ProjectGraphPage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  const t = useTranslations().projectGraph;

  // Raw maps are the source of truth; the force-graph view is derived from them.
  const [rawNodes, setRawNodes] = useState<Map<string, ContextGraphNodeDto>>(new Map());
  const [rawEdges, setRawEdges] = useState<Map<string, ContextGraphEdgeDto>>(new Map());
  const [graph, setGraph] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [overlays, setOverlays] = useState<ProjectGraphOverlay[]>([]);
  const [overlayKind, setOverlayKind] = useState('note');
  const [overlayContent, setOverlayContent] = useState('');
  const [overlayAuthor, setOverlayAuthor] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sub = await fetchProjectSubgraph(decoded, { limit: 300 });
      setRawNodes(new Map(sub.nodes.map((n) => [n.id, n])));
      setRawEdges(new Map(sub.edges.map((e) => [e.id, e])));
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

  // Derive force-graph data, reusing existing node objects (preserve x/y so the
  // layout doesn't reset/jitter when neighbors are merged in).
  useEffect(() => {
    setGraph((prev) => {
      const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
      const nodes: GNode[] = Array.from(rawNodes.values()).map((n) => {
        const existing = prevById.get(n.id);
        if (existing) {
          existing.name = n.title;
          existing.kind = nodeKindOf(n);
          return existing;
        }
        return { id: n.id, name: n.title, kind: nodeKindOf(n) };
      });
      const ids = new Set(nodes.map((n) => n.id));
      const links: GLink[] = Array.from(rawEdges.values())
        .filter((e) => ids.has(e.sourceId) && ids.has(e.targetId))
        .map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId, kind: edgeKindOf(e) }));
      return { nodes, links };
    });
  }, [rawNodes, rawEdges]);

  // Track container size so the canvas fills the available area (width + height).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, panelCollapsed]);

  // Custom canvas navigation: hold the RIGHT mouse button to pan, left button is
  // reserved for selecting nodes. The library's built-in pan is disabled via
  // `enablePanInteraction={false}` (it only ever binds the left button anyway),
  // so this never fights it; wheel-zoom stays on through `enableZoomInteraction`.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || loading) return;
    let panning = false;
    let last = { x: 0, y: 0 };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 2) return; // right button only
      panning = true;
      last = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!panning || !fgRef.current) return;
      const k = fgRef.current.zoom() || 1;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      const c = fgRef.current.centerAt(); // current center in graph coords
      fgRef.current.centerAt(c.x - dx / k, c.y - dy / k, 0);
    };
    const onUp = () => { panning = false; };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    el.addEventListener('mousedown', onDown);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [loading]);

  const mergeSubgraph = useCallback((sub: { nodes: ContextGraphNodeDto[]; edges: ContextGraphEdgeDto[] }) => {
    setRawNodes((prev) => {
      const m = new Map(prev);
      for (const n of sub.nodes) m.set(n.id, n);
      return m;
    });
    setRawEdges((prev) => {
      const m = new Map(prev);
      for (const e of sub.edges) m.set(e.id, e);
      return m;
    });
  }, []);

  const expandNode = useCallback(
    async (id: string) => {
      const sub = await fetchProjectSubgraph(decoded, { focus: id, limit: 200 });
      mergeSubgraph(sub);
    },
    [decoded, mergeSubgraph],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      setSelectedId(node.id);
      void expandNode(node.id);
      if (fgRef.current && typeof node.x === 'number') {
        fgRef.current.centerAt(node.x, node.y, 500);
        fgRef.current.zoom(2.2, 500);
      }
    },
    [expandNode],
  );

  const doSearch = useCallback(() => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const hit = Array.from(rawNodes.values()).find((n) => n.title.toLowerCase().includes(q));
    if (hit) {
      setSelectedId(hit.id);
      void expandNode(hit.id);
    }
  }, [search, rawNodes, expandNode]);

  const selectedNode = selectedId ? rawNodes.get(selectedId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!selectedId) return [];
    return Array.from(rawEdges.values()).filter((e) => e.sourceId === selectedId || e.targetId === selectedId);
  }, [rawEdges, selectedId]);
  const visibleOverlays = overlays.filter(
    (o) => o.project === decoded && (!selectedId || o.targetNodeId === selectedId),
  );

  const saveOverlay = async () => {
    if (!selectedId || !overlayContent.trim()) return;
    setSaving(true);
    setStatus('');
    try {
      const resp = await fetch('/api/project-graph-overlays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: decoded,
          targetNodeId: selectedId,
          kind: overlayKind,
          content: overlayContent.trim(),
          author: overlayAuthor.trim() || undefined,
        }),
      });
      if (!resp.ok) throw new Error(`${t.saveFailedPrefix}: ${resp.status}`);
      const data = await resp.json();
      setOverlays((cur) => [data.overlay, ...cur]);
      setOverlayContent('');
      setStatus(t.overlaySaved);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col px-6 py-5">
      <div className="mb-4 anim-in d1 flex items-end justify-between gap-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.title}</h1>
            <span className="px-2 py-0.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-md border border-brand-100">
              {decoded}
            </span>
          </div>
          <p className="text-sm text-surface-500 font-medium">{t.graphDescription}</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn-outline px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Icon icon="lucide:refresh-cw" className="text-sm" />
          {t.refresh}
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-surface-400">{t.loading}</div>
      ) : (
        <section
          className={`flex-1 min-h-0 grid gap-5 ${
            panelCollapsed || !selectedNode ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_360px]'
          }`}
        >
          <div className="relative bg-white rounded-2xl border border-surface-200 anim-in d2 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-100 flex-shrink-0">
              <div className="relative flex-1">
                <Icon icon="lucide:search" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                  placeholder={t.searchPlaceholder}
                  className="w-full pl-9 pr-3 py-1.5 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
                />
              </div>
              <span className="text-xs text-surface-400 font-medium shrink-0">{graph.nodes.length} {t.indexed}</span>
            </div>
            <div ref={containerRef} className="relative flex-1 min-h-0">
              {graph.nodes.length === 0 ? (
                <p className="p-6 text-sm text-surface-400">{t.noNodesIndexed}</p>
              ) : (
                <ForceGraph2D
                  ref={fgRef}
                  width={size.width}
                  height={size.height}
                  graphData={graph}
                  nodeId="id"
                  nodeLabel="name"
                  nodeRelSize={5}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  nodeColor={(n: any) => (n.id === selectedId ? '#ef4444' : kindColor(n.kind))}
                  linkColor={() => '#cbd5e1'}
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={1}
                  cooldownTicks={80}
                  enableNodeDrag={false}
                  enablePanInteraction={false}
                  onNodeClick={handleNodeClick}
                />
              )}
              {selectedNode && panelCollapsed && (
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(false)}
                  title={t.expandPanel}
                  aria-label={t.expandPanel}
                  className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-surface-200 shadow-sm hover:bg-surface-50 text-surface-600"
                >
                  <Icon icon="lucide:panel-right-open" className="text-base" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-surface-100 flex-shrink-0">
              {Object.entries(NODE_KIND_COLOR).slice(0, 8).map(([k, c]) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-surface-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                  {k}
                </span>
              ))}
            </div>
          </div>

          {selectedNode && !panelCollapsed && (
            <aside className="bg-white rounded-2xl border border-surface-200 anim-in d3 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-surface-100 flex-shrink-0">
                <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: kindColor(nodeKindOf(selectedNode)) }}>
                  {nodeKindOf(selectedNode)}
                </span>
                <button
                  type="button"
                  onClick={() => setPanelCollapsed(true)}
                  title={t.collapsePanel}
                  aria-label={t.collapsePanel}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-100 text-surface-500"
                >
                  <Icon icon="lucide:panel-right-close" className="text-base" />
                </button>
              </div>
              <div className="space-y-4 p-5 overflow-y-auto">
                <div>
                  <h2 className="text-base font-bold text-surface-900 break-words">{selectedNode.title}</h2>
                  {selectedNode.sourceRef && (
                    <p className="mt-1 text-xs text-surface-400 font-mono break-words">{selectedNode.sourceRef}</p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-50 p-3 text-sm text-surface-700">
                    {selectedNode.content}
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-surface-900 mb-2">{t.relationships}</h3>
                  {selectedEdges.length === 0 ? (
                    <p className="text-sm text-surface-400">{t.relationshipsNone}</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {selectedEdges.map((e) => {
                        const outbound = e.sourceId === selectedId;
                        const otherId = outbound ? e.targetId : e.sourceId;
                        const other = rawNodes.get(otherId);
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => { setSelectedId(otherId); void expandNode(otherId); }}
                            className="block w-full text-left rounded-lg border border-surface-100 bg-surface-50 p-2 text-xs hover:bg-surface-100"
                          >
                            <span className="font-semibold text-surface-700">{outbound ? '→' : '←'} {edgeKindOf(e)}</span>
                            <span className="block mt-0.5 truncate text-surface-600">{other?.title ?? otherId}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-surface-900 mb-2">{t.addOverlay}</h3>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={overlayKind}
                      onChange={(e) => setOverlayKind(e.target.value)}
                      className="px-2 py-1.5 border border-surface-200 rounded-lg text-sm font-medium text-surface-700 outline-none focus:border-brand-400"
                    >
                      {OVERLAY_KINDS.map((v) => (
                        <option key={v} value={v}>{t.overlayKind[v] ?? v}</option>
                      ))}
                    </select>
                    <input
                      value={overlayAuthor}
                      onChange={(e) => setOverlayAuthor(e.target.value)}
                      placeholder={t.overlayAuthorPlaceholder}
                      className="flex-1 min-w-0 px-2 py-1.5 border border-surface-200 rounded-lg text-sm outline-none focus:border-brand-400"
                    />
                  </div>
                  <textarea
                    value={overlayContent}
                    onChange={(e) => setOverlayContent(e.target.value)}
                    placeholder={t.overlayContentPlaceholder}
                    className="w-full min-h-24 px-3 py-2 border border-surface-200 rounded-lg text-sm outline-none focus:border-brand-400"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveOverlay}
                      disabled={saving || !overlayContent.trim()}
                      className="btn-primary px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {saving ? t.savingOverlay : t.saveOverlay}
                    </button>
                    {status && <span className="text-xs text-surface-500">{status}</span>}
                  </div>
                </div>

                {visibleOverlays.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-surface-900 mb-2">{t.nodeOverlays}</h3>
                    <div className="space-y-2">
                      {visibleOverlays.map((o) => (
                        <article key={o.id} className="rounded-lg border border-surface-100 bg-surface-50 p-2.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-surface-500">
                            <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-surface-800">{t.overlayKind[o.kind] ?? o.kind}</span>
                            {o.author && <span>{o.author}</span>}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-surface-700">{o.content}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </section>
      )}
    </div>
  );
}
