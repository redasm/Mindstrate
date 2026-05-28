import type { ReactNode } from 'react';
import { Icon } from './Icon';

type Props = {
  icon?: string;
  title: string;
  description?: string;
  cta?: ReactNode;
};

export function EmptyState({ icon = 'lucide:inbox', title, description, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-16 h-16 rounded-2xl bg-brand-50 text-brand-500 flex items-center justify-center mb-4">
        <Icon icon={icon} className="text-3xl" />
      </div>
      <h3 className="text-base font-bold text-surface-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-surface-500 max-w-md mb-4">{description}</p>}
      {cta}
    </div>
  );
}
