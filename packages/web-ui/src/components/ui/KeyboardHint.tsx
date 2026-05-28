type Props = { keys: string[] };
export function KeyboardHint({ keys }: Props) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="px-1.5 py-0.5 text-[10px] font-mono font-medium text-surface-500 bg-white border border-surface-200 rounded"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
