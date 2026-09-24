export type RangeMode = "today" | "yesterday" | "thisMonth" | "lastMonth" | "custom";

export interface DateRange {
  label: string;
  startMs: number;
  endMs: number; // exclusive
  /** Set only when the range is exactly one calendar day. */
  singleDayKey: string | null;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function resolveRange(
  mode: RangeMode,
  custom: { from: string; to: string },
): DateRange {
  const now = new Date();

  if (mode === "today") {
    const start = startOfDay(now);
    return { label: "Today", startMs: start.getTime(), endMs: addDays(start, 1).getTime(), singleDayKey: dayKey(start) };
  }

  if (mode === "yesterday") {
    const start = startOfDay(addDays(now, -1));
    return {
      label: "Yesterday",
      startMs: start.getTime(),
      endMs: addDays(start, 1).getTime(),
      singleDayKey: dayKey(start),
    };
  }

  if (mode === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { label: "This month", startMs: start.getTime(), endMs: end.getTime(), singleDayKey: null };
  }

  if (mode === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { label: "Last month", startMs: start.getTime(), endMs: end.getTime(), singleDayKey: null };
  }

  // custom
  const from = custom.from ? startOfDay(new Date(custom.from)) : startOfDay(now);
  const to = custom.to ? startOfDay(new Date(custom.to)) : from;
  const end = addDays(to, 1);
  const singleDay = from.getTime() === to.getTime();
  return {
    label: custom.from && custom.to ? `${custom.from} → ${custom.to}` : "Custom range",
    startMs: from.getTime(),
    endMs: end.getTime(),
    singleDayKey: singleDay ? dayKey(from) : null,
  };
}
