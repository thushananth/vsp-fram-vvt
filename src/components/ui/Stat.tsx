export default function Stat({
  label,
  value,
  note,
  noteColor = "text-muted",
  tone = "default",
}: {
  label: string;
  value: string;
  note?: string;
  noteColor?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        tone === "warning" ? "border-warning/30 bg-warning/5" : "border-border bg-surface"
      }`}
    >
      <div
        className={`text-[11px] font-bold uppercase tracking-wider ${
          tone === "warning" ? "text-warning" : "text-muted-2"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-extrabold leading-tight tabular-nums ${
          tone === "warning" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </div>
      {note && <div className={`text-xs font-semibold ${noteColor}`}>{note}</div>}
    </div>
  );
}
