"use client";

import { Delete } from "lucide-react";

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

const KEYS: PadKey[] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];

/**
 * An on-screen number pad. The till's fields are display boxes rather than
 * inputs, so a tablet never throws its own keyboard over half the sheet.
 */
export default function NumPad({
  onKey,
  allowDecimal = true,
}: {
  onKey: (key: PadKey) => void;
  allowDecimal?: boolean;
}) {
  return (
    <div className="grid select-none grid-cols-3 gap-2">
      {KEYS.map((k) => {
        const disabled = k === "." && !allowDecimal;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onKey(k)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={k === "back" ? "Delete" : k === "." ? "Decimal point" : k}
            className={`tabular-nums flex h-14 items-center justify-center rounded-2xl text-2xl font-bold transition-colors active:scale-[0.96] disabled:opacity-30 sm:h-16 ${
              k === "back" ? "bg-ground text-muted active:bg-border" : "border border-border bg-surface text-ink active:bg-ground"
            }`}
          >
            {k === "back" ? <Delete className="h-6 w-6" /> : k}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onKey("clear")}
        className="col-span-3 h-11 rounded-2xl bg-ground text-sm font-bold uppercase tracking-wider text-muted active:bg-border"
      >
        Clear
      </button>
    </div>
  );
}

/**
 * Apply one key to a field's text. `fresh` means the field was just selected:
 * the first digit replaces the old value instead of being appended to it, so
 * selecting a qty of 1 and typing 2.5 gives 2.5, not 12.5.
 */
export function applyKey(text: string, key: PadKey, opts: { fresh: boolean; decimals: number }): string {
  if (key === "clear") return "";
  if (key === "back") return opts.fresh ? "" : text.slice(0, -1);
  const base = opts.fresh ? "" : text;
  if (key === ".") {
    if (opts.decimals === 0 || base.includes(".")) return base;
    return base === "" ? "0." : `${base}.`;
  }
  const [, frac] = base.split(".");
  if (frac !== undefined && frac.length >= opts.decimals) return base;
  if (base.replace(".", "").length >= 9) return base;
  if (base === "0") return key;
  return base + key;
}
