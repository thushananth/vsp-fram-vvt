import { localDateKey } from "@/lib/format";
import { ToolInputError, type MsRange } from "./types";

/** Longest range of bills or payments one call may read (inclusive days). */
export const MAX_RANGE_DAYS = 62;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Local midnight of a "yyyy-mm-dd" day, or a ToolInputError. */
export function dayStartMs(key: unknown, field = "date"): number {
  if (typeof key !== "string" || !DAY_KEY.test(key)) {
    throw new ToolInputError(`${field} must be a day written yyyy-mm-dd, got ${JSON.stringify(key)}.`);
  }
  // "T00:00:00" parses as local midnight; a bare date parses as UTC.
  const ms = new Date(`${key}T00:00:00`).getTime();
  if (Number.isNaN(ms) || localDateKey(ms) !== key) {
    throw new ToolInputError(`${field} ${key} is not a real calendar day.`);
  }
  return ms;
}

export function addDaysMs(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function daysBetween(fromKey: string, toKey: string): number {
  const a = new Date(`${fromKey}T12:00:00`).getTime();
  const b = new Date(`${toKey}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** from..to inclusive, as a ms range, checked against MAX_RANGE_DAYS. */
export function dayRange(from: unknown, to: unknown): MsRange & { from: string; to: string } {
  const startMs = dayStartMs(from, "from");
  const toStart = dayStartMs(to ?? from, "to");
  if (toStart < startMs) throw new ToolInputError("to is before from. Swap them.");
  const fromKey = from as string;
  const toKey = (to ?? from) as string;
  const days = daysBetween(fromKey, toKey) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ToolInputError(
      `The range ${fromKey}..${toKey} is ${days} days. At most ${MAX_RANGE_DAYS} days per call: split it into smaller ranges.`,
    );
  }
  return { from: fromKey, to: toKey, startMs, endMs: addDaysMs(toStart, 1) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-07 11:42" in local time. Fixed width, so strings compare in order. */
export function stamp(ms: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return `${localDateKey(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "11:42" in local time. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Saturday 7 November 2026", for the system instruction. */
export function longDay(ms: number): string {
  // Built by hand: locale formatting differs between browsers.
  const d = new Date(ms);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()];
  return `${weekday} ${d.getDate()} ${month} ${d.getFullYear()} (${localDateKey(ms)})`;
}

/** "1–7 Nov", "7 Nov", "28 Oct–3 Nov": short range labels for tool chips. */
export function rangeLabel(from: string, to: string): string {
  const f = new Date(`${from}T12:00:00`);
  const t = new Date(`${to}T12:00:00`);
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  if (from === to) return `${f.getDate()} ${month(f)}`;
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${f.getDate()}–${t.getDate()} ${month(t)}`;
  }
  return `${f.getDate()} ${month(f)}–${t.getDate()} ${month(t)}`;
}
