'use client';

import { Icon } from './Icon';

type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (next: string) => void;
  options: Option[];
  icon?: string;
  className?: string;
};

export function FilterDropdown({ value, onChange, options, icon, className = '' }: Props) {
  return (
    <div
      className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-surface-200 bg-white hover:border-surface-300 transition-all ${className}`}
    >
      {icon && <Icon icon={icon} className="text-sm text-surface-400" />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-medium text-surface-700 outline-none pr-5 appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <Icon icon="lucide:chevron-down" className="text-xs text-surface-400 pointer-events-none absolute right-2.5" />
    </div>
  );
}
