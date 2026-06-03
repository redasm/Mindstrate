'use client';

import { useMemo, useState } from 'react';
import type { SkillEvolutionPatch } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

interface Props {
  initialPatches: SkillEvolutionPatch[];
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
  const [baseline, setBaseline] = useState('0.5');
  const [candidate, setCandidate] = useState('0.7');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
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

  const evaluate = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/skill-evolution/${encodeURIComponent(selected.id)}?action=evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baselineScore: Number(baseline), candidateScore: Number(candidate) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Evaluation failed (${res.status})`);
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

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-surface-900">{t.title}</h1>
        <p className="text-sm text-surface-500">{t.description}</p>
      </header>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stat label={t.total} value={counts.total} />
        <Stat label={t.candidate} value={counts.candidate} />
        <Stat label={t.accepted} value={counts.accepted} />
        <Stat label={t.rejected} value={counts.rejected} />
      </div>

      {patches.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-white p-6 text-sm text-surface-500">
          {t.empty}
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_1.4fr] gap-4">
          <ul className="rounded-lg border border-surface-200 bg-white divide-y divide-surface-100 overflow-hidden">
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

          <div className="rounded-lg border border-surface-200 bg-white p-4">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLES[selected.status]}`}>{selected.status}</span>
                    <span className="text-xs text-surface-400">{selected.id}</span>
                  </div>
                  <p className="text-sm text-surface-700 mt-2">{selected.rationale}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <DiffBlock title={t.before} content={selected.beforeContent} />
                  <DiffBlock title={t.after} content={selected.afterContent} />
                </div>

                <p className="text-xs text-surface-400">
                  {t.budget}: {selected.budget.maxChangedBullets} {t.bullets} · {selected.budget.maxChangedTokens} {t.tokens}
                </p>

                {selected.status === 'candidate' && (
                  <div className="border-t border-surface-100 pt-4 space-y-3">
                    <div className="flex items-end gap-2">
                      <Field label={t.baselineScore} value={baseline} onChange={setBaseline} />
                      <Field label={t.candidateScore} value={candidate} onChange={setCandidate} />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={evaluate}
                        className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
                      >
                        <Icon icon="lucide:gauge" className="text-sm mr-1 inline" />
                        {t.evaluate}
                      </button>
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

function DiffBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-surface-500 mb-1">{title}</div>
      <pre className="text-xs bg-surface-50 border border-surface-100 rounded-md p-2 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{content}</pre>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-surface-500">
      {label}
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-24 rounded-md border border-surface-200 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
