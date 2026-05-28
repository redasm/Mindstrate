type Slice = { label: string; value: number; color: string };
type Props = { slices: Slice[]; size?: number; thickness?: number };

export function DonutChart({ slices, size = 160, thickness = 22 }: Props) {
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#f1f5f9" strokeWidth={thickness} fill="none" />
        {slices.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={s.color}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          className="fill-surface-900"
          style={{ fontFamily: 'inherit', fontSize: 22, fontWeight: 700 }}
        >
          {total}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 16}
          textAnchor="middle"
          className="fill-surface-400"
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em' }}
        >
          TOTAL
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="font-medium text-surface-700">{s.label}</span>
            <span className="text-surface-400 font-mono">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
