'use client';

import { useMemo, useState } from 'react';
import type { EvalCase, EvalCaseKind, EvalRunResult } from '@mindstrate/protocol';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

interface Props {
  initialCases: EvalCase[];
}

export function EvalDatasetClient({ initialCases }: Props) {
  const tAll = useTranslations();
  const t = tAll.evalDataset;
  const [cases, setCases] = useState<EvalCase[]>(initialCases);
  const [query, setQuery] = useState('');
  const [expected, setExpected] = useState('');
  const [kind, setKind] = useState<EvalCaseKind>('validation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<EvalRunResult | null>(null);

  const counts = useMemo(() => ({
    total: cases.length,
    validation: cases.filter((c) => c.kind === 'validation').length,
    holdout: cases.filter((c) => c.kind === 'holdout').length,
  }), [cases]);

  const refresh = async () => {
    const res = await fetch('/api/eval-cases');
    if (res.ok) {
      const data = await res.json();
      setCases(data.cases ?? []);
    }
  };

  const addCase = async () => {
    const expectedIds = expected.split(',').map((s) => s.trim()).filter(Boolean);
    if (!query.trim() || expectedIds.length === 0) {
      setError(t.addValidationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/eval-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), expectedIds, kind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Add failed (${res.status})`);
        return;
      }
      setQuery('');
      setExpected('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/eval-cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runEval = async (scope?: EvalCaseKind) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/eval-cases/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope ? { kind: scope } : {}),
      });
      if (res.ok) setRun(await res.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-surface-900">{t.title}</h1>
        <p className="text-sm text-surface-500">{t.description}</p>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label={t.total} value={counts.total} />
        <Stat label={t.validation} value={counts.validation} />
        <Stat label={t.holdout} value={counts.holdout} />
      </div>

      <div className="rounded-lg border border-surface-200 bg-white p-4 mb-5 space-y-3">
        <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-2 items-end">
          <label className="text-xs text-surface-500">
            {t.query}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-1 w-full rounded-md border border-surface-200 px-2 py-1.5 text-sm"
              placeholder={t.queryPlaceholder}
            />
          </label>
          <label className="text-xs text-surface-500">
            {t.expectedIds}
            <input
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="mt-1 w-full rounded-md border border-surface-200 px-2 py-1.5 text-sm"
              placeholder={t.expectedIdsPlaceholder}
            />
          </label>
          <label className="text-xs text-surface-500">
            {t.kind}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as EvalCaseKind)}
              className="mt-1 w-full rounded-md border border-surface-200 px-2 py-1.5 text-sm"
            >
              <option value="validation">{t.validation}</option>
              <option value="holdout">{t.holdout}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={addCase}
            className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
          >
            <Icon icon="lucide:plus" className="text-sm mr-1 inline" />
            {t.add}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="flex gap-2 mb-3">
        <button type="button" disabled={busy} onClick={() => runEval()} className="px-3 py-1.5 rounded-md border border-surface-300 text-sm font-medium disabled:opacity-50">{t.runAll}</button>
        <button type="button" disabled={busy} onClick={() => runEval('validation')} className="px-3 py-1.5 rounded-md border border-surface-300 text-sm font-medium disabled:opacity-50">{t.runValidation}</button>
        <button type="button" disabled={busy} onClick={() => runEval('holdout')} className="px-3 py-1.5 rounded-md border border-surface-300 text-sm font-medium disabled:opacity-50">{t.runHoldout}</button>
      </div>

      {run && (
        <div className="rounded-lg border border-surface-200 bg-white p-4 mb-5 text-sm text-surface-700">
          {t.lastRun}: {run.totalCases} {t.cases} · P {run.precision.toFixed(3)} · R {run.recall.toFixed(3)} · F1 {run.f1.toFixed(3)} · MRR {run.meanReciprocalRank.toFixed(3)}
        </div>
      )}

      {cases.length === 0 ? (
        <div className="rounded-lg border border-surface-200 bg-white p-6 text-sm text-surface-500">{t.empty}</div>
      ) : (
        <ul className="rounded-lg border border-surface-200 bg-white divide-y divide-surface-100 overflow-hidden">
          {cases.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${c.kind === 'holdout' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>{c.kind}</span>
                  <span className="text-sm text-surface-800 truncate">{c.query}</span>
                </div>
                <p className="text-xs text-surface-500 truncate mt-0.5">{t.expectedIds}: {c.expectedIds.join(', ')}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => remove(c.id)} className="text-surface-400 hover:text-red-600 disabled:opacity-50">
                <Icon icon="lucide:trash-2" className="text-sm" />
              </button>
            </li>
          ))}
        </ul>
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
