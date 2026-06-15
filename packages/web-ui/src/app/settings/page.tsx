import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { getMemoryReady } from '@/lib/memory';
import { detectLocale } from '@/lib/i18n/index';
import { getTranslations } from '@/lib/i18n/translations';
import { listWorkspaceProjects } from '@/lib/workspace-projects';

export const dynamic = 'force-dynamic';

type ProjectStat = {
  name: string;
  entries: number;
  lastActivity: string | null;
  conflicts: number;
};

const TYPE_COLORS: Record<string, string> = {
  pattern: '#7c3aed',
  rule: '#6366f1',
  summary: '#94a3b8',
  skill: '#059669',
  snapshot: '#d97706',
  episode: '#0ea5e9',
  knowledge: '#10b981',
};

const LANG_COLORS: Record<string, string> = {
  typescript: '#818cf8',
  javascript: '#fbbf24',
  go: '#34d399',
  python: '#f59e0b',
  rust: '#f97316',
  sql: '#94a3b8',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function avatarLetters(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'bg-pink-100 text-pink-600',
  'bg-blue-100 text-blue-600',
  'bg-green-100 text-green-600',
  'bg-amber-100 text-amber-600',
  'bg-indigo-100 text-indigo-600',
  'bg-red-100 text-red-600',
  'bg-cyan-100 text-cyan-600',
  'bg-orange-100 text-orange-600',
];

export default async function SettingsOverviewPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const memory = await getMemoryReady();
  const stats = await memory.maintenance.getStats();
  const projects = listWorkspaceProjects(memory);
  const users = memory.apiKeys.listAll();
  const allNodes = memory.context.listContextNodes({ limit: 100000 });

  const adminCount = users.filter((u) => u.role === 'admin' && !u.revokedAt).length;
  const memberCount = users.filter((u) => u.role === 'member' && !u.revokedAt).length;

  const projectStats: ProjectStat[] = projects
    .map((name) => {
      const projectNodes = allNodes.filter((n) => n.project === name);
      const conflicts = projectNodes.filter((n) => n.status === 'conflicted').length;
      const lastActivity = projectNodes.reduce<string | null>((latest, n) => {
        const ts = n.updatedAt ?? n.createdAt ?? null;
        if (!ts) return latest;
        if (!latest || ts > latest) return ts;
        return latest;
      }, null);
      return { name, entries: projectNodes.length, lastActivity, conflicts };
    })
    .sort((a, b) => b.entries - a.entries);

  const totalConflicts = projectStats.reduce((s, p) => s + p.conflicts, 0);

  const typeEntries = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  const typeTotal = typeEntries.reduce((s, [, v]) => s + v, 0) || 1;
  let donutOffset = 25;
  const donutSegs = typeEntries.map(([type, value]) => {
    const pct = (value / typeTotal) * 100;
    const seg = {
      type,
      value,
      pct,
      color: TYPE_COLORS[type.toLowerCase()] ?? '#94a3b8',
      dasharray: `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`,
      offset: donutOffset,
    };
    donutOffset = (donutOffset - pct + 100) % 100;
    return seg;
  });

  const langEntries = Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langMax = Math.max(...langEntries.map(([, v]) => v), 1);

  const recentRuns = memory.metabolism.listMetabolismRuns(undefined, 7);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-5">
      <div className="mb-6 anim-in d1">
        <h1 className="text-2xl font-bold tracking-tight text-surface-900 mb-1">{t.settingsOverview.title}</h1>
        <p className="text-sm text-surface-500 font-medium">{t.settingsOverview.description}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          delay="d2"
          icon="lucide:brain"
          iconBg="bg-brand-50"
          iconColor="text-brand-500"
          label={t.settingsOverview.totalKnowledge}
          value={stats.total.toLocaleString()}
        />
        <StatCard
          delay="d3"
          icon="lucide:database"
          iconBg="bg-violet-50"
          iconColor="text-violet-500"
          label={t.settingsOverview.vectorIndex}
          value={stats.vectorCount.toLocaleString()}
          suffix={t.settingsOverview.vectors}
        />
        <StatCard
          delay="d4"
          icon="lucide:folder-kanban"
          iconBg="bg-emerald-50"
          iconColor="text-emerald-500"
          label={t.settingsOverview.activeProjects}
          value={projects.length.toString()}
          badge={totalConflicts > 0
            ? { label: `${totalConflicts} ${t.settingsOverview.alerts}`, color: 'amber' }
            : { label: t.common.healthy, color: 'emerald' }}
        />
        <StatCard
          delay="d5"
          icon="lucide:users"
          iconBg="bg-sky-50"
          iconColor="text-sky-500"
          label={t.settingsOverview.registeredUsers}
          value={users.length.toString()}
          footer={
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-brand-400" />
                <span className="text-[11px] text-surface-500 font-medium">{adminCount} {t.settingsOverview.adminCount}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-surface-300" />
                <span className="text-[11px] text-surface-500 font-medium">{memberCount} {t.settingsOverview.memberCount}</span>
              </span>
            </div>
          }
        />
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4 anim-in d6">
          <div>
            <h2 className="text-base font-bold tracking-tight text-surface-900">{t.settingsOverview.projects}</h2>
            <p className="text-xs text-surface-400 font-medium mt-0.5">{t.settingsOverview.projectsHint}</p>
          </div>
        </div>
        {projectStats.length === 0 ? (
          <div className="bg-white rounded-xl border border-surface-200 p-10 text-center text-sm text-surface-400">
            {t.settingsOverview.noProjectsCta}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {projectStats.map((p, i) => {
              const grad = AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length];
              return (
                <Link
                  key={p.name}
                  href={`/p/${encodeURIComponent(p.name)}/knowledge`}
                  className="project-card group bg-white rounded-xl p-4 anim-in"
                  style={{ animationDelay: `${0.04 * (i + 7)}s` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${grad}`}>
                        {avatarLetters(p.name)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-surface-800 tracking-tight leading-tight truncate">{p.name}</h3>
                      </div>
                    </div>
                    <Icon icon="lucide:arrow-up-right" className="text-sm text-brand-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </div>
                  <div className="flex items-center gap-4 mb-3">
                    <div>
                      <p className="text-lg font-extrabold text-surface-800 tracking-tight leading-none">{p.entries}</p>
                      <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">{t.settingsOverview.entries}</p>
                    </div>
                    <div className="w-px h-8 bg-surface-100" />
                    <div>
                      <p className="text-xs font-semibold text-surface-600">{timeAgo(p.lastActivity)}</p>
                      <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">{t.settingsOverview.lastActive}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-surface-100">
                    {p.conflicts === 0 ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <Icon icon="lucide:check-circle" className="text-[9px]" />
                        {t.common.healthy}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-600 border border-red-100">
                        <Icon icon="lucide:alert-circle" className="text-[9px]" />
                        {p.conflicts} {p.conflicts === 1 ? t.settingsOverview.conflictsOne : t.settingsOverview.conflictsMany}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="chart-card bg-white rounded-xl border border-surface-200 p-5 anim-in d10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-surface-800">{t.settingsOverview.typeDistribution}</h3>
              <p className="text-[11px] text-surface-400 font-medium mt-0.5">{t.settingsOverview.typeDistHint}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-surface-50 flex items-center justify-center">
              <Icon icon="lucide:pie-chart" className="text-sm text-surface-400" />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative flex-shrink-0">
              <svg width="140" height="140" viewBox="0 0 42 42">
                <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                {donutSegs.map((s) => (
                  <circle
                    key={s.type}
                    cx="21"
                    cy="21"
                    r="15.9155"
                    fill="none"
                    stroke={s.color}
                    strokeWidth="4"
                    strokeDasharray={s.dasharray}
                    strokeDashoffset={s.offset}
                    strokeLinecap="butt"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-extrabold text-surface-900 leading-none tracking-tight">{stats.total}</span>
                <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">{t.common.total}</span>
              </div>
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              {donutSegs.length === 0 && <p className="text-xs text-surface-400">{t.settingsOverview.noEntries}</p>}
              {donutSegs.slice(0, 6).map((s) => (
                <div key={s.type} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-xs font-medium text-surface-600 truncate">{s.type}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-bold text-surface-800">{s.value}</span>
                    <span className="text-[10px] font-semibold text-surface-400">{s.pct.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="chart-card bg-white rounded-xl border border-surface-200 p-5 anim-in d11">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-surface-800">{t.settingsOverview.languageDistribution}</h3>
              <p className="text-[11px] text-surface-400 font-medium mt-0.5">{t.settingsOverview.languageDistHint}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-surface-50 flex items-center justify-center">
              <Icon icon="lucide:bar-chart-3" className="text-sm text-surface-400" />
            </div>
          </div>
          {langEntries.length === 0 ? (
            <p className="py-8 text-sm text-surface-400 text-center">{t.settingsOverview.noLanguageData}</p>
          ) : (
            <div className="flex items-end justify-between gap-3 h-[140px] px-1">
              {langEntries.map(([lang, value]) => {
                const heightPct = Math.max(((value / langMax) * 100), 4);
                const color = LANG_COLORS[lang.toLowerCase()] ?? '#cbd5e1';
                return (
                  <div key={lang} className="flex flex-col items-center flex-1 h-full justify-end">
                    <div className="w-full rounded-t" style={{ height: `${heightPct}%`, background: color }} />
                    <span className="text-[10px] font-semibold text-surface-400 mt-2 capitalize">{lang}</span>
                    <span className="text-[10px] font-bold text-surface-600">{value}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="chart-card bg-white rounded-xl border border-surface-200 p-5 anim-in d12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-surface-800">{t.settingsOverview.recentActivity}</h3>
              <p className="text-[11px] text-surface-400 font-medium mt-0.5">{t.settingsOverview.recentActivityHint}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-surface-50 flex items-center justify-center">
              <Icon icon="lucide:activity" className="text-sm text-surface-400" />
            </div>
          </div>
          {recentRuns.length === 0 ? (
            <p className="py-8 text-sm text-surface-400 text-center">{t.settingsOverview.noMetabolism}</p>
          ) : (
            <div className="space-y-0 relative">
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-surface-200" />
              {recentRuns.map((run) => {
                const ok = run.status === 'completed';
                const failed = run.status === 'failed' || run.status === 'cancelled';
                const iconBg = failed ? 'bg-red-100 border-red-400' : ok ? 'bg-emerald-100 border-emerald-400' : 'bg-brand-100 border-brand-400';
                const iconColor = failed ? 'text-red-600' : ok ? 'text-emerald-600' : 'text-brand-600';
                const iconName = failed ? 'lucide:alert-triangle' : ok ? 'lucide:check' : 'lucide:refresh-cw';
                return (
                  <div key={run.id} className="flex items-start gap-3 py-2 relative">
                    <div className={`w-[23px] h-[23px] rounded-full border-2 flex items-center justify-center flex-shrink-0 z-10 ${iconBg}`}>
                      <Icon icon={iconName} className={`text-[10px] ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-600 leading-relaxed">
                        {t.settingsOverview.metabolismRun} <span className="font-semibold text-surface-800">{run.trigger}</span>
                        {run.project ? <> {t.settingsOverview.on} <span className="font-semibold text-surface-800">{run.project}</span></> : null}
                      </p>
                      <p className="text-[10px] text-surface-400 font-medium mt-0.5">
                        {run.status} · {timeAgo(run.startedAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  delay,
  icon,
  iconBg,
  iconColor,
  label,
  value,
  suffix,
  badge,
  footer,
}: {
  delay: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  suffix?: string;
  badge?: { label: string; color: 'emerald' | 'amber' | 'surface' };
  footer?: React.ReactNode;
}) {
  const badgeClasses = badge?.color === 'amber'
    ? 'bg-amber-50 border-amber-100 text-amber-600'
    : badge?.color === 'surface'
      ? 'bg-surface-50 border-surface-200 text-surface-500'
      : 'bg-emerald-50 border-emerald-100 text-emerald-600';

  return (
    <div className={`stat-card bg-white rounded-xl p-5 border border-surface-200 anim-in ${delay}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon icon={icon} className={`text-xl ${iconColor}`} />
        </div>
        {badge && (
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${badgeClasses}`}>
            <span className="text-[11px] font-bold">{badge.label}</span>
          </div>
        )}
      </div>
      <div>
        <p className="text-3xl font-extrabold tracking-tight text-surface-900 leading-none mb-1">
          {value}
          {suffix && <span className="text-xs font-bold text-surface-400 ml-1.5">{suffix}</span>}
        </p>
        <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{label}</p>
      </div>
      {footer && <div className="mt-3 pt-3 border-t border-surface-100">{footer}</div>}
    </div>
  );
}
