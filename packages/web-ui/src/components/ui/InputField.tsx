import type { ReactNode, InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  icon?: string;
  trailing?: ReactNode;
};

export function InputField({ icon, trailing, className = '', ...rest }: Props) {
  return (
    <div className={`input-field ${className}`}>
      {icon && (
        <div className="pl-3.5">
          <Icon icon={icon} className="input-icon text-surface-400 text-base transition-colors" />
        </div>
      )}
      <input
        {...rest}
        className="flex-1 px-3 py-2.5 bg-transparent text-surface-900 placeholder-surface-400 text-sm font-medium outline-none"
      />
      {trailing && <div className="pr-2">{trailing}</div>}
    </div>
  );
}
