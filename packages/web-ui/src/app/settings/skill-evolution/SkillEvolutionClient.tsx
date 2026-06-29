'use client';

import { useMemo, useState } from 'react';
import type { SkillEvolutionPatch } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

interface Props {
  initialPatches: SkillEvolutionPatch[];
}

interface OptimizeResult {
  nodeId: string;
  outcome: string;
}

const STATUS_STYLES: Record<SkillEvolutionPatch['status'], string> = {
  candidate: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-surface-100 text-surface-500 border-surface-200',
};

export function SkillEvolutionClient({ initialPatches }: Props) {
  const tAll = useTranslations();
  const t = tAll.skillEvolution;
  const [patches, setPatches] = useState<SkillEvolutionPatch[]>(initialPatches);
  const [selectedId, setSelectedId] = useState<string | null>(initialPatches[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizerSummary, setOptimizerSummary] = useState<string | null>(null);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => ({
    total: patches.length,
    candidate: patches.filter((p) => p.status === 'candidate').length,
    accepted: patches.filter((p) => p.status === 'accepted').length,
    rejected: patches.filter((p) => p.status === 'rejected').length,
  }), [patches]);

  const selected = patches.find((p) => p.id === selectedId) ?? null;

  const refresh = async () => {
    const res = await fetch('/api/skill-evolution?limit=100');
    if (res.ok) {
      const data = await res.json();
      setPatches(data.patches ?? []);
    }
  };

  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/skill-evolution/${encodeURIComponent(selected.id)}?action=approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Approve failed (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!selected || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/skill-evolution/${encodeURIComponent(selected.id)}?action=reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Reject failed (${res.status})`);
        return;
      }
      setReason('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runOptimizer = async () => {
    setOptimizing(true);
    setOptimizerSummary(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/skill-evolution/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Optimizer run failed (${res.status})`);
        return;
      }
      const data = await res.json() as { results: OptimizeResult[]; total: number };
      if (data.total === 0) {
        setOptimizerSummary(t.optimizerNoTargets);
      } else {
        const by = (outcome: string) => data.results.filter((r) => r.outcome === outcome).length;
        setOptimizerSummary(
          `${t.optimizerRan} ${data.total} · ${t.optimizerPending} ${by('insufficient_data')} · ${t.accepted} ${by('accepted')} · ${t.rejected} ${by('gate_rejected') + by('budget_rejected')} · ${t.optimizerNoProposal} ${by('no_proposal')} · ${t.optimizerSkipped} ${by('suppressed_known_rejection') + by('suppressed_pending_candidate') + by('missing_node')}`,
        );
      }
      await refresh();
    } finally {
      setOptimizing(false);
    }
  };

  const pruneOrphans = async () => {
    if (!window.confirm(t.pruneConfirm)) return;
    setPruning(true);
    setOptimizerSummary(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/skill-evolution/prune-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Prune failed (${res.status})`);
        return;
      }
      const data = await res.json() as { patchesDeleted: number };
      setOptimizerSummary(`${t.pruned} ${data.patchesDeleted}`);
      await refresh();
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-5 max-w-6xl mx-auto w-full">
      <header className="mb-5 flex items-start justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-surface-900">{t.title}</h1>
          <p className="text-sm text-surface-500">{t.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={pruning}
            onClick={pruneOrphans}
            className="px-3 py-1.5 rounded-md border border-surface-300 text-surface-700 text-sm font-medium hover:bg-surface-50 disabled:opacity-50"
          >
            <Icon icon={pruning ? 'lucide:loader-2' : 'lucide:trash-2'} className={`text-sm mr-1 inline ${pruning ? 'animate-spin' : ''}`} />
            {pruning ? t.pruning : t.pruneOrphans}
          </button>
          <button
            type="button"
            disabled={optimizing}
            onClick={runOptimizer}
            className="px-3 py-1.5 rounded-md border border-brand-300 text-brand-700 text-sm font-medium hover:bg-brand-50 disabled:opacity-50"
          >
            <Icon icon={optimizing ? 'lucide:loader-2' : 'lucide:sparkles'} className={`text-sm mr-1 inline ${optimizing ? 'animate-spin' : ''}`} />
            {optimizing ? t.optimizing : t.optimize}
          </button>
        </div>
      </header>

      {optimizerSummary && (
        <p className="mb-4 text-xs text-surface-600 bg-surface-50 border border-surface-200 rounded-md px-3 py-2 flex-shrink-0">
          {optimizerSummary}
        </p>
      )}

      <div className="grid grid-cols-4 gap-3 mb-5 flex-shrink-0">
        <Stat label={t.total} value={counts.total} />
        <Stat label={t.candidate} value={counts.candidate} />
        <Stat label={t.accepted} value={counts.accepted} />
        <Stat label={t.rejected} value={counts.rejected} />
      </div>

      {patches.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-white p-6 text-sm text-surface-500 flex-shrink-0">
          {t.empty}
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_1.4fr] gap-4 flex-1 min-h-0">
          <ul className="rounded-lg border border-surface-200 bg-white divide-y divide-surface-100 overflow-y-auto">
            {patches.map((patch) => (
              <li key={patch.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(patch.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${selectedId === patch.id ? 'bg-brand-50' : 'hover:bg-surface-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-surface-800 truncate">{patch.operation} · {patch.sourceNodeId}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLES[patch.status]}`}>{patch.status}</span>
                  </div>
                  <p className="text-xs text-surface-500 truncate mt-0.5">{patch.rationale}</p>
                </button>
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-surface-200 bg-white p-4 overflow-y-auto">
            {selected ? (
              <div className="flex flex-col h-full gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLES[selected.status]}`}>{selected.status}</span>
                    <span className="text-xs text-surface-400">{selected.id}</span>
                  </div>
                  <p className="text-sm text-surface-700 mt-2">{selected.rationale}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
                  <DiffBlock title={t.before} content={selected.beforeContent} emptyLabel={t.beforeEmpty} />
                  <DiffBlock title={t.after} content={selected.afterContent} emptyLabel={t.afterEmpty} />
                </div>

                <p className="text-xs text-surface-400 flex-shrink-0">
                  {t.budget}: {selected.budget.maxChangedBullets} {t.bullets} · {selected.budget.maxChangedTokens} {t.tokens}
                </p>

                {selected.status === 'candidate' && (
                  <div className="border-t border-surface-100 pt-4 space-y-3 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={approve}
                        className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
                      >
                        <Icon icon="lucide:check" className="text-sm mr-1 inline" />
                        {t.approve}
                      </button>
                      <p className="text-xs text-surface-400">{t.approveHint}</p>
                    </div>
                    <div className="flex items-end gap-2">
                      <label className="flex-1 text-xs text-surface-500">
                        {t.rejectReason}
                        <input
                          type="text"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="mt-1 w-full rounded-md border border-surface-200 px-2 py-1.5 text-sm"
                          placeholder={t.rejectReasonPlaceholder}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || !reason.trim()}
                        onClick={reject}
                        className="px-3 py-1.5 rounded-md border border-surface-300 text-surface-700 text-sm font-medium disabled:opacity-50"
                      >
                        {t.reject}
                      </button>
                    </div>
                  </div>
                )}

                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>
            ) : (
              <p className="text-sm text-surface-500">{t.selectPatch}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-white px-4 py-3">
      <div className="text-2xl font-semibold text-surface-900">{value}</div>
      <div className="text-xs text-surface-500">{label}</div>
    </div>
  );
}

function DiffBlock({ title, content, emptyLabel }: { title: string; content: string; emptyLabel: string }) {
  const isEmpty = content.trim().length === 0;
  return (
    <div className="flex flex-col min-h-0">
      <div className="text-xs font-medium text-surface-500 mb-1 flex-shrink-0">{title}</div>
      {isEmpty ? (
        <div className="flex-1 min-h-[6rem] flex items-center justify-center text-xs text-surface-400 italic bg-surface-50 border border-dashed border-surface-200 rounded-md p-2">
          {emptyLabel}
        </div>
      ) : (
        <pre className="flex-1 min-h-[6rem] text-xs bg-surface-50 border border-surface-100 rounded-md p-2 whitespace-pre-wrap break-words overflow-y-auto">{content}</pre>
      )}
    </div>
  );
}
