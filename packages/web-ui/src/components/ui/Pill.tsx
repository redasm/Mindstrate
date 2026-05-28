import type { ReactNode } from 'react';

type Variant = 'pattern' | 'rule' | 'summary' | 'skill' | 'snapshot' | 'neutral';

const VARIANT_CLASS: Record<Variant, string> = {
  pattern: 'pill-pattern',
  rule: 'pill-rule',
  summary: 'pill-summary',
  skill: 'pill-skill',
  snapshot: 'pill-snapshot',
  neutral: 'pill-summary',
};

export function Pill({
  variant = 'neutral',
  children,
  className = '',
}: {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`pill ${VARIANT_CLASS[variant]} ${className}`}>{children}</span>;
}

export function KnowledgeTypePill({ type }: { type: string }) {
  const t = type.toLowerCase();
  const variant: Variant =
    t.includes('pattern') ? 'pattern'
    : t.includes('rule') ? 'rule'
    : t.includes('skill') ? 'skill'
    : t.includes('snapshot') ? 'snapshot'
    : 'summary';
  return <Pill variant={variant}>{type}</Pill>;
}

export function RolePill({ role, label }: { role: 'admin' | 'member'; label?: string }) {
  return (
    <span className={`role-pill ${role === 'admin' ? 'role-admin' : 'role-member'}`}>
      {label ?? role}
    </span>
  );
}

export function ProjectPill({ project }: { project: string }) {
  return <span className="project-tag">{project}</span>;
}

export function StatusPill({ status, label }: { status: 'on' | 'off' | 'error'; label?: string }) {
  const cls = status === 'on' ? 'status-on' : status === 'error' ? 'status-error' : 'status-off';
  const text = label ?? (status === 'on' ? 'Active' : status === 'error' ? 'Error' : 'Disabled');
  return (
    <span className={`status-pill ${cls}`}>
      <span className="status-dot" />
      {text}
    </span>
  );
}
