type Event = { label: string; time: string; color?: string };
type Props = { events: Event[] };

export function Timeline({ events }: Props) {
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-surface-200">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[18px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white"
            style={{ background: e.color ?? '#6366f1' }}
          />
          <div className="text-sm font-semibold text-surface-800">{e.label}</div>
          <div className="text-[11px] text-surface-400 font-mono">{e.time}</div>
        </li>
      ))}
    </ol>
  );
}
