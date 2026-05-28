import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary rounded-xl font-semibold tracking-tight',
  outline: 'btn-outline rounded-xl font-semibold',
  ghost: 'rounded-lg text-surface-600 hover:bg-surface-100 hover:text-surface-900 transition-all',
  danger: 'btn-danger rounded-xl font-semibold',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 ${SIZE[size]} ${VARIANT[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}
