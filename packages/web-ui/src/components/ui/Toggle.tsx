'use client';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
};

export function Toggle({ checked, onChange, disabled, title }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`toggle-track ${checked ? 'on' : 'off'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="toggle-knob" />
    </button>
  );
}
