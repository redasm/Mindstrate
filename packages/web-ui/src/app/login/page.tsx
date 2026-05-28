'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-50" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ret = params.get('return') ?? '/';
  const t = useTranslations();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !key.trim()) {
      setError(t.auth.bothRequired);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), key: key.trim() }),
      });
      if (!resp.ok) {
        setError(resp.status === 401 ? t.auth.invalidCredentials : t.auth.genericError);
        return;
      }
      router.push(ret);
      router.refresh();
    } catch {
      setError(t.auth.networkError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 grid-bg flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-brand-200 rounded-full blur-3xl glow-orb pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-brand-100 rounded-full blur-3xl glow-orb-2 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-gradient-radial-brand rounded-full blur-2xl opacity-60 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center w-full px-4">
        <div className="mb-10 text-center anim-in">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-500/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h10M4 18h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="20" cy="12" r="2.5" fill="white" opacity="0.7" />
              </svg>
            </div>
            <span className="text-2xl font-bold tracking-tight text-surface-900">
              <span className="text-brand-600">MS</span> Mindstrate
            </span>
          </div>
          <p className="text-surface-500 text-base font-medium tracking-tight">{t.auth.title}</p>
        </div>

        <div className="w-full max-w-[400px] bg-white rounded-2xl modal-shadow p-8 anim-in d2">
          {error && (
            <div className="mb-5 -mt-1">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                <Icon icon="lucide:alert-circle" className="text-red-500 text-base flex-shrink-0" />
                <span className="text-sm font-medium text-red-700">{error}</span>
              </div>
            </div>
          )}

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5 tracking-tight">{t.auth.nameLabel}</label>
              <div className="input-field flex items-center border border-surface-200 rounded-xl bg-surface-50 transition-all duration-200">
                <div className="pl-3.5 pr-0 py-3">
                  <Icon icon="lucide:user" className="text-surface-400 text-base" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.auth.namePlaceholder}
                  autoComplete="username"
                  className="flex-1 px-3 py-3 bg-transparent text-surface-900 placeholder-surface-400 text-sm font-medium outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5 tracking-tight">{t.auth.keyLabel}</label>
              <div className="input-field flex items-center border border-surface-200 rounded-xl bg-surface-50 transition-all duration-200">
                <div className="pl-3.5 pr-0 py-3">
                  <Icon icon="lucide:key-round" className="text-surface-400 text-base" />
                </div>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={t.auth.keyPlaceholder}
                  autoComplete="current-password"
                  className="flex-1 px-3 py-3 bg-transparent text-surface-900 placeholder-surface-400 text-sm font-medium font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="reveal-btn mr-2 p-1.5 rounded-lg text-surface-400"
                  title={showKey ? t.auth.hideKey : t.auth.showKey}
                >
                  <Icon icon={showKey ? 'lucide:eye-off' : 'lucide:eye'} className="text-base" />
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full py-3 px-4 rounded-xl text-white text-sm font-semibold tracking-tight flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? t.auth.submitting : t.auth.submit}
                {!busy && <Icon icon="lucide:arrow-right" className="text-base" />}
              </button>
            </div>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-surface-200" />
            <span className="text-xs text-surface-400 font-medium">{t.auth.needHelp}</span>
            <div className="flex-1 h-px bg-surface-200" />
          </div>

          <p className="text-center text-sm text-surface-500 leading-relaxed">
            {t.auth.forgotKey}{' '}
            <span className="text-brand-600 font-semibold">{t.auth.settingsUsers}</span>.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-2 anim-in d5">
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium text-surface-400 bg-white border border-surface-200 rounded-md shadow-sm">⌘</kbd>
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-medium text-surface-400 bg-white border border-surface-200 rounded-md shadow-sm">K</kbd>
          </div>
          <span className="text-xs text-surface-400 font-medium">{t.auth.quickSearchHint}</span>
        </div>

        <div className="mt-8 text-center anim-in d5">
          <p className="text-xs text-surface-400 font-medium">{t.auth.brandLine}</p>
        </div>
      </div>

      <div className="absolute top-6 left-6 anim-in d4">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[10px] font-mono text-surface-400 font-medium">{t.auth.systemOnline}</span>
        </div>
      </div>
    </div>
  );
}
