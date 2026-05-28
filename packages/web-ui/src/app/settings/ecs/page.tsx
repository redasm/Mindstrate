'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  SUBSTRATE_ORDER,
  fetchContextEdges,
  fetchContextGraph,
  type ContextGraphEdgeDto,
  type ContextGraphNodeDto,
} from '@/lib/context-graph-api';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

type ConflictRecord = {
  id: string;
  project?: string;
  nodeIds: string[];
  reason: string;
  detectedAt: string;
  resolvedAt?: string;
  resolution?: string;
};

type MetabolismRun = {
  id: string;
  project?: string;
  trigger: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  stageStats: Record<string, { scanned: number; created: number; updated: number; skipped: number }>;
  notes?: string[];
};

type ProjectionRecord = {
  id: string;
  nodeId: string;
  target: string;
  targetRef: string;
  version: number;
  projectedAt: string;
};

export default function SettingsEcsPage() {
  const t = useTranslations();
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [runs, setRuns] = useState<MetabolismRun[]>([]);
  const [projections, setProjections] = useState<ProjectionRecord[]>([]);
  const [nodes, setNodes] = useState<ContextGraphNodeDto[]>([]);
  const [edges, setEdges] = useState<ContextGraphEdgeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [stage, setStage] = useState('');
  const [stageResult, setStageResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [conflictsRes, runsRes, projectionsRes, graphNodes, graphEdges] = await Promise.all([
        fetch('/api/context-conflicts?limit=20'),
        fetch('/api/metabolism-runs?limit=10'),
        fetch('/api/projection-records?limit=10'),
        fetchContextGraph(120),
        fetchContextEdges(400),
      ]);
      if (conflictsRes.ok) {
        const data = await conflictsRes.json();
        setConflicts(data.conflicts || []);
      }
      if (runsRes.ok) {
        const data = await runsRes.json();
        setRuns(data.runs || []);
      }
      if (projectionsRes.ok) {
        const data = await projectionsRes.json();
        setProjections(data.records || []);
      }
      setNodes(graphNodes);
      setEdges(graphEdges);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const triggerMetabolism = async () => {
    setTriggering(true);
    setStageResult(null);
    try {
      const res = await fetch('/api/metabolism-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stage ? { stage } : { trigger: 'manual' }),
      });
      if (res.ok) {
        if (stage) {
          const data = await res.json();
          setStageResult(JSON.stringify(data, null, 2));
        } else {
          await load();
        }
      }
    } finally {
      setTriggering(false);
    }
  };

  const layerCounts = SUBSTRATE_ORDER.map((substrate) => ({
    substrate,
    count: nodes.filter((node) => node.substrateType === substrate).length,
  }));
  const maxLayerCount = Math.max(...layerCounts.map((layer) => layer.count), 1);
  const relationCounts = edges.reduce<Record<string, number>>((acc, edge) => {
    acc[edge.relationType] = (acc[edge.relationType] ?? 0) + 1;
    return acc;
  }, {});
  const activeNodeCount = nodes.filter((n) => n.status === 'active' || n.status === 'verified').length;
  const conflictedNodeCount = nodes.filter((n) => n.status === 'conflicted').length;
  const averageQuality = nodes.length === 0 ? 0 : nodes.reduce((s, n) => s + n.qualityScore, 0) / nodes.length;
  const lineageEdges = edges.filter((e) => ['derived_from', 'generalizes', 'instantiates', 'supports'].includes(e.relationType)).length;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5 space-y-6">
      <div className="anim-in d1">
        <h1 className="text-2xl font-bold tracking-tight text-surface-900 mb-1">{t.ecs.title}</h1>
        <p className="text-sm text-surface-500 font-medium">{t.ecs.description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 anim-in d2">
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-700 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
          aria-label={t.ecs.stageDigest}
        >
          <option value="">{t.ecs.fullRun}</option>
          <option value="digest">{t.ecs.stageDigest}</option>
          <option value="assimilate">{t.ecs.stageAssimilate}</option>
          <option value="compress">{t.ecs.stageCompress}</option>
          <option value="prune">{t.ecs.stagePrune}</option>
          <option value="reflect">{t.ecs.stageReflect}</option>
        </select>
        <button
          type="button"
          onClick={triggerMetabolism}
          disabled={triggering}
          className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Icon icon="lucide:play" className="text-sm" />
          {triggering ? t.ecs.running : stage ? t.ecs.runStage : t.ecs.runMetabolism}
        </button>
        <Link
          href="/settings/lineage"
          className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
        >
          <Icon icon="lucide:network" className="text-sm" />
          {t.ecs.openLineage}
        </Link>
      </div>

      {stageResult && (
        <section className="bg-white rounded-2xl border border-surface-200 p-5 anim-in">
          <h2 className="text-base font-bold text-surface-900 mb-2">{t.ecs.stageResult}</h2>
          <pre className="overflow-x-auto rounded-lg bg-surface-900 p-4 text-xs text-surface-100 font-mono">
            {stageResult}
          </pre>
        </section>
      )}

      {loading && <div className="py-10 text-center text-sm text-surface-400">{t.ecs.loading}</div>}

      <section className="grid gap-4 md:grid-cols-4 anim-in d3">
        <MetricCard icon="lucide:layers" iconBg="bg-brand-50" iconColor="text-brand-500" label={t.ecs.graphNodes} value={nodes.length} />
        <MetricCard icon="lucide:circle-check" iconBg="bg-emerald-50" iconColor="text-emerald-500" label={t.ecs.activeSubstrate} value={activeNodeCount} />
        <MetricCard icon="lucide:link-2" iconBg="bg-sky-50" iconColor="text-sky-500" label={t.ecs.relations} value={edges.length} />
        <MetricCard icon="lucide:gauge" iconBg="bg-violet-50" iconColor="text-violet-500" label={t.ecs.avgQuality} value={Math.round(averageQuality)} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] anim-in d4">
        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-surface-900">{t.ecs.projectGraph}</h2>
              <p className="mt-0.5 text-xs text-surface-400 font-medium">{t.ecs.projectGraphHint}</p>
            </div>
            <Link href="/settings/lineage" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              {t.ecs.inspectLineage}
            </Link>
          </div>

          <div className="space-y-3">
            {layerCounts.map((layer) => (
              <div key={layer.substrate} className="grid grid-cols-[100px_minmax(0,1fr)_44px] items-center gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-surface-500">{layer.substrate}</div>
                <div className="h-3 overflow-hidden rounded-full bg-surface-100">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${Math.max((layer.count / maxLayerCount) * 100, layer.count > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <div className="text-right text-sm font-bold text-surface-900">{layer.count}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MiniStat label={t.ecs.lineageEdges} value={lineageEdges} />
            <MiniStat label={t.ecs.conflictedNodes} value={conflictedNodeCount} tone="amber" />
            <MiniStat label={t.ecs.projects} value={new Set(nodes.map((n) => n.project).filter(Boolean)).size} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <h2 className="text-base font-bold text-surface-900">{t.ecs.relationMix}</h2>
          <p className="mt-0.5 text-xs text-surface-400 font-medium">{t.ecs.relationMixHint}</p>

          {Object.keys(relationCounts).length === 0 ? (
            <p className="py-8 text-sm text-surface-400">{t.ecs.noRelations}</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(relationCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([relation, count]) => (
                  <span key={relation} className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1 text-xs">
                    <span className="font-semibold text-surface-900">{relation}</span>
                    <span className="text-surface-500">· {count}</span>
                  </span>
                ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2 anim-in d5">
        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-surface-900">{t.ecs.activeConflicts}</h2>
            <span className="rounded-full bg-amber-50 border border-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
              {conflicts.length}
            </span>
          </div>
          {conflicts.length === 0 ? (
            <p className="py-8 text-sm text-surface-400">{t.ecs.noConflicts}</p>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c) => (
                <article key={c.id} className="rounded-lg border border-surface-100 bg-surface-50 p-4">
                  <h3 className="font-semibold text-surface-900 text-sm">{c.reason}</h3>
                  <div className="mt-2 space-y-1 text-xs text-surface-500">
                    {c.project && <div>{t.common.project}: <span className="font-medium text-surface-700">{c.project}</span></div>}
                    <div>{t.ecs.detected}: {new Date(c.detectedAt).toLocaleString()}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {c.nodeIds.map((id) => (
                        <Link
                          key={id}
                          href={`/settings/lineage?node=${encodeURIComponent(id)}`}
                          className="rounded-md bg-white border border-surface-200 px-2 py-0.5 font-mono text-[11px] text-brand-700 hover:bg-brand-50"
                        >
                          {id.slice(0, 8)}…
                        </Link>
                      ))}
                    </div>
                    {c.resolution && <div>{t.ecs.resolution}: {c.resolution}</div>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-surface-200 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-surface-900">{t.ecs.metabolismRuns}</h2>
            <span className="rounded-full bg-sky-50 border border-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-700">
              {runs.length}
            </span>
          </div>
          {runs.length === 0 ? (
            <p className="py-8 text-sm text-surface-400">{t.ecs.noRuns}</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {runs.map((run) => {
                const ok = run.status === 'completed' || run.status === 'succeeded';
                const failed = run.status === 'failed' || run.status === 'error';
                const badgeClass = failed
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : ok
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                    : 'bg-brand-50 border-brand-100 text-brand-700';
                return (
                  <article key={run.id} className="rounded-lg border border-surface-100 bg-surface-50 p-4">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
                        {run.status}
                      </span>
                      <span className="text-[11px] uppercase tracking-wider text-surface-400 font-semibold">{run.trigger}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-surface-900">{run.project || t.ecs.globalSubstrate}</div>
                    <div className="mt-1 text-xs text-surface-500">
                      <div>{t.ecs.started}: {new Date(run.startedAt).toLocaleString()}</div>
                      {run.endedAt && <div>{t.ecs.ended}: {new Date(run.endedAt).toLocaleString()}</div>}
                    </div>
                    {Object.keys(run.stageStats).length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {Object.entries(run.stageStats).map(([s, stats]) => (
                          <div key={s} className="rounded-md bg-white border border-surface-100 p-2.5 text-[11px] text-surface-600">
                            <div className="font-bold text-surface-900 mb-0.5">{s}</div>
                            <div className="grid grid-cols-2 gap-x-2">
                              <span>scanned <span className="font-mono">{stats?.scanned ?? 0}</span></span>
                              <span>created <span className="font-mono">{stats?.created ?? 0}</span></span>
                              <span>updated <span className="font-mono">{stats?.updated ?? 0}</span></span>
                              <span>skipped <span className="font-mono">{stats?.skipped ?? 0}</span></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-surface-200 p-5 anim-in d6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-surface-900">{t.ecs.projectionRecords}</h2>
          <span className="rounded-full bg-violet-50 border border-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-700">
            {projections.length}
          </span>
        </div>
        {projections.length === 0 ? (
          <p className="py-8 text-sm text-surface-400">{t.ecs.noProjections}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-100">
            <table className="min-w-full divide-y divide-surface-100 text-sm">
              <thead className="bg-surface-50 text-left text-[11px] uppercase tracking-wider text-surface-400 font-bold">
                <tr>
                  <th className="px-4 py-2.5">{t.ecs.target}</th>
                  <th className="px-4 py-2.5">{t.ecs.targetRef}</th>
                  <th className="px-4 py-2.5">{t.ecs.version}</th>
                  <th className="px-4 py-2.5">{t.ecs.projected}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 text-surface-600">
                {projections.map((rec) => (
                  <tr key={rec.id}>
                    <td className="px-4 py-2.5 font-semibold text-surface-900">{rec.target}</td>
                    <td className="max-w-md truncate px-4 py-2.5 font-mono text-xs">{rec.targetRef}</td>
                    <td className="px-4 py-2.5">{rec.version}</td>
                    <td className="px-4 py-2.5 text-xs">{new Date(rec.projectedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
}: {
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  value: number;
}) {
  return (
    <div className="stat-card bg-white rounded-xl border border-surface-200 p-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
        <Icon icon={icon} className={`text-xl ${iconColor}`} />
      </div>
      <p className="text-3xl font-extrabold tracking-tight text-surface-900 leading-none mb-1">{value}</p>
      <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  const valueClass = tone === 'amber' ? 'text-amber-700' : 'text-surface-900';
  return (
    <div className="rounded-lg bg-surface-50 border border-surface-100 p-4">
      <div className="text-[11px] uppercase tracking-wider text-surface-400 font-semibold">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
    </div>
  );
}
