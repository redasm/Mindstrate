'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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

export default function EcsPage() {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [runs, setRuns] = useState<MetabolismRun[]>([]);
  const [projections, setProjections] = useState<ProjectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [stage, setStage] = useState('');
  const [stageResult, setStageResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [conflictsRes, runsRes, projectionsRes] = await Promise.all([
      fetch('/api/context-conflicts?limit=20'),
      fetch('/api/metabolism-runs?limit=10'),
      fetch('/api/projection-records?limit=10'),
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
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ECS Control Panel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inspect active conflicts and recent metabolism runs in the context substrate.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={stage}
          onChange={(event) => setStage(event.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
          aria-label="Metabolism stage"
        >
          <option value="">Full run</option>
          <option value="digest">Digest</option>
          <option value="assimilate">Assimilate</option>
          <option value="compress">Compress</option>
          <option value="prune">Prune</option>
          <option value="reflect">Reflect</option>
        </select>
        <button
          type="button"
          onClick={triggerMetabolism}
          disabled={triggering}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {triggering ? 'Running...' : stage ? 'Run Stage' : 'Run Metabolism'}
        </button>
        <Link href="/lineage" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          Open Lineage View
        </Link>
      </div>

      {stageResult ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Stage Result</h2>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
            {stageResult}
          </pre>
        </section>
      ) : null}

      {loading ? <div className="py-12 text-center text-gray-400">Loading ECS panels...</div> : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Active Conflicts</h2>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {conflicts.length}
            </span>
          </div>

          {conflicts.length === 0 ? (
            <p className="py-8 text-sm text-gray-400">No active ECS conflicts.</p>
          ) : (
            <div className="space-y-4">
              {conflicts.map((conflict) => (
                <article key={conflict.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <h3 className="font-medium text-gray-900">{conflict.reason}</h3>
                  <div className="mt-2 text-xs text-gray-500">
                    {conflict.project ? <div>Project: {conflict.project}</div> : null}
                    <div>Detected: {new Date(conflict.detectedAt).toLocaleString()}</div>
                    <div className="flex flex-wrap gap-2">
                      {conflict.nodeIds.map((nodeId) => (
                        <Link
                          key={nodeId}
                          href={`/lineage?node=${encodeURIComponent(nodeId)}`}
                          className="rounded-md bg-white px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
                        >
                          {nodeId.slice(0, 8)}...
                        </Link>
                      ))}
                    </div>
                    {conflict.resolution ? <div>Resolution: {conflict.resolution}</div> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Metabolism Runs</h2>
            <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
              {runs.length}
            </span>
          </div>

          {runs.length === 0 ? (
            <p className="py-8 text-sm text-gray-400">No metabolism runs recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {runs.map((run) => (
                <article key={run.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      {run.status}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-gray-400">{run.trigger}</span>
                  </div>
                  <div className="mt-2 text-sm font-medium text-gray-900">
                    {run.project || 'Global substrate'}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-gray-500">
                    <div>Started: {new Date(run.startedAt).toLocaleString()}</div>
                    {run.endedAt ? <div>Ended: {new Date(run.endedAt).toLocaleString()}</div> : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(run.stageStats).map(([stage, stats]) => (
                      <div key={stage} className="rounded-md bg-white p-3 text-xs text-gray-600">
                        <div className="font-medium text-gray-900">{stage}</div>
                        <div>scanned {stats?.scanned ?? 0}</div>
                        <div>created {stats?.created ?? 0}</div>
                        <div>updated {stats?.updated ?? 0}</div>
                        <div>skipped {stats?.skipped ?? 0}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Projection Records</h2>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
            {projections.length}
          </span>
        </div>
        {projections.length === 0 ? (
          <p className="py-8 text-sm text-gray-400">No projection records materialized yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Target Ref</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Projected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-600">
                {projections.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{record.target}</td>
                    <td className="max-w-md truncate px-4 py-3">{record.targetRef}</td>
                    <td className="px-4 py-3">{record.version}</td>
                    <td className="px-4 py-3">{new Date(record.projectedAt).toLocaleString()}</td>
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
