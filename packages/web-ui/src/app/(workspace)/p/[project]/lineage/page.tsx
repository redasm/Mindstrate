'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { truncateText } from '@mindstrate/protocol/text';
import {
  SUBSTRATE_ORDER,
  fetchContextEdges,
  fetchContextGraph,
  type ContextGraphEdgeDto,
  type ContextGraphNodeDto,
} from '@/lib/context-graph-api';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

export default function ProjectLineagePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = use(params);
  const decoded = decodeURIComponent(project);
  return (
    <Suspense fallback={<LineageFallback />}>
      <Inner project={decoded} />
    </Suspense>
  );
}

function LineageFallback() {
  const t = useTranslations();
  return <div className="py-12 text-center text-sm text-surface-400">{t.lineage.loading}</div>;
}

function Inner({ project }: { project: string }) {
  const tAll = useTranslations();
  const t = tAll.lineage;
  const searchParams = useSearchParams();
  const [nodes, setNodes] = useState<ContextGraphNodeDto[]>([]);
  const [edges, setEdges] = useState<ContextGraphEdgeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [substrate, setSubstrate] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, e] = await Promise.all([fetchContextGraph(200), fetchContextEdges(400)]);
      setNodes(n.filter((node) => (node.project ?? '') === project));
      setEdges(e);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = searchParams.get('node');
    if (id) setSelectedId(id);
  }, [searchParams]);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (substrate !== 'all' && n.substrateType !== substrate) return false;
      if (!q) return true;
      const h = `${n.title}\n${n.content}\n${n.domainType}\n${n.tags.join(' ')}`.toLowerCase();
      return h.includes(q);
    });
  }, [nodes, query, substrate]);

  const grouped = useMemo(() => {
    const map = new Map<string, ContextGraphNodeDto[]>();
    for (const s of SUBSTRATE_ORDER) map.set(s, []);
    for (const n of filtered) {
      const list = map.get(n.substrateType) ?? [];
      list.push(n);
      map.set(n.substrateType, list);
    }
    return map;
  }, [filtered]);

  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!selectedId) return [];
    return edges.filter((e) => e.sourceId === selectedId || e.targetId === selectedId);
  }, [edges, selectedId]);

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-5">
      <div className="mb-5 anim-in d1">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold tracking-tight text-surface-900">{t.title}</h1>
          <span className="px-2 py-0.5 text-xs font-semibold text-brand-600 bg-brand-50 rounded-md border border-brand-100">
            {project}
          </span>
        </div>
        <p className="text-sm text-surface-500 font-medium">
          {t.descriptionProject}
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-surface-200 p-4 mb-5 anim-in d2">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Icon icon="lucide:search" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-surface-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            />
          </div>
          <select
            value={substrate}
            onChange={(e) => setSubstrate(e.target.value)}
            className="px-3 py-2 border border-surface-200 rounded-lg text-sm font-medium text-surface-700 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          >
            <option value="all">{t.allLayers}</option>
            {SUBSTRATE_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 text-xs text-surface-400 font-medium">
          {t.showing} {filtered.length} {t.of} {nodes.length} {t.nodes}
        </div>
      </section>

      {loading ? (
        <div className="py-12 text-center text-sm text-surface-400">{t.loadingShort}</div>
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {SUBSTRATE_ORDER.map((s) => {
              const g = grouped.get(s) ?? [];
              if (g.length === 0) return null;
              return (
                <div key={s} className="bg-white rounded-2xl border border-surface-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold capitalize text-surface-900">{s}</h2>
                    <span className="rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-600 font-medium">{g.length}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {g.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedId(n.id)}
                        className={`rounded-lg border p-4 text-left transition-all ${
                          selectedId === n.id ? 'border-brand-300 bg-brand-50' : 'border-surface-100 bg-surface-50 hover:bg-surface-100'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="project-tag">{n.domainType}</span>
                          <span className="ml-auto text-xs text-surface-400">q {n.qualityScore.toFixed(0)}</span>
                        </div>
                        <h3 className="text-sm font-semibold text-surface-900">{n.title}</h3>
                        <p className="mt-1.5 text-xs text-surface-500 leading-relaxed line-clamp-3">
                          {truncateText(n.content, 180)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="bg-white rounded-2xl border border-surface-200 p-10 text-center text-sm text-surface-400">
                {t.noNodes}
              </div>
            )}
          </div>

          <aside className="bg-white rounded-2xl border border-surface-200 p-5 h-fit">
            <h2 className="text-base font-bold text-surface-900 mb-3">{t.nodeDetails}</h2>
            {!selected ? (
              <p className="text-sm text-surface-400">{t.selectNode}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="project-tag">{selected.substrateType}</span>
                    <span className="rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-600 font-medium">{selected.domainType}</span>
                  </div>
                  <h3 className="text-base font-bold text-surface-900">{selected.title}</h3>
                  <p className="mt-2 text-sm text-surface-700 leading-6">{selected.content}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Detail label={t.detailStatus} value={selected.status} />
                  <Detail label={t.detailQuality} value={selected.qualityScore.toFixed(0)} />
                </div>
                <Detail label={t.detailNodeId} value={selected.id} mono />
                <div>
                  <h4 className="text-sm font-semibold text-surface-900 mb-2">{t.relationships}</h4>
                  {selectedEdges.length === 0 ? (
                    <p className="text-sm text-surface-400">{t.relationshipsNone}</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedEdges.map((e) => {
                        const out = e.sourceId === selected.id;
                        const otherId = out ? e.targetId : e.sourceId;
                        const other = nodesById.get(otherId);
                        return (
                          <div key={e.id} className="rounded-lg border border-surface-100 bg-surface-50 p-3 text-sm">
                            <div className="font-semibold text-surface-900">
                              {out ? '→' : '←'} {e.relationType}
                            </div>
                            <div className="mt-1 text-surface-600 truncate">{other?.title ?? otherId}</div>
                            <div className="mt-1 text-xs text-surface-400">{t.strength} {e.strength.toFixed(2)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-surface-100 bg-surface-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">{label}</div>
      <div className={`mt-1 text-sm text-surface-700 ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
