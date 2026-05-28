type Bar = { label: string; value: number };
type Props = { bars: Bar[]; max?: number; color?: string };

export function BarChart({ bars, max, color = '#6366f1' }: Props) {
  const peak = max ?? Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-24 text-xs font-medium text-surface-600 truncate">{b.label}</span>
          <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(b.value / peak) * 100}%`, background: color }}
            />
          </div>
          <span className="w-10 text-xs text-surface-500 text-right font-mono">{b.value}</span>
        </div>
      ))}
    </div>
  );
}
