export function money(n: number): string {
  return `Rs ${n.toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
}

export function timeOfDay(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" });
}

export function dateAndTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-LK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * yyyy-mm-dd in the device's local time. toISOString() is UTC, which in
 * Sri Lanka (UTC+5:30) files everything sold before 05:30 under the day before.
 */
export function localDateKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
