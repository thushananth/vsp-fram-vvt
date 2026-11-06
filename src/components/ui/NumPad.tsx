"use client";

import { Delete } from "lucide-react";

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

/** 1 on top, like a phone — the shop types on phones and tablets, not calculators. */
const KEYS: PadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
/** A phone's dial pad for mobile numbers: no decimal point, so Clear sits where "*" would be. */
const PHONE_KEYS: PadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

/**
 * An on-screen number pad. The till's fields are display boxes rather than
 * inputs, so a tablet never throws its own keyboard over half the sheet.
 * Both layouts put 1 2 3 on top. `layout="phone"` is for mobile numbers: it
 * drops the decimal point and puts Clear in that corner instead of a bar.
 */
export default function NumPad({
  onKey,
  allowDecimal = true,
  layout = "calculator",
}: {
  onKey: (key: PadKey) => void;
  allowDecimal?: boolean;
  layout?: "calculator" | "phone";
}) {
  const phone = layout === "phone";
  return (
    <div className="grid select-none grid-cols-3 gap-2">
      {(phone ? PHONE_KEYS : KEYS).map((k) => {
        const disabled = k === "." && !allowDecimal;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onKey(k)}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={k === "back" ? "Delete" : k === "." ? "Decimal point" : k === "clear" ? "Clear" : k}
            className={`tabular-nums flex h-14 items-center justify-center rounded-2xl text-2xl font-bold transition-colors active:scale-[0.96] disabled:opacity-30 sm:h-16 ${
              k === "back" || k === "clear"
                ? "bg-ground text-muted active:bg-border"
                : "border border-border bg-surface text-ink active:bg-ground"
            }`}
          >
            {k === "back" ? (
              <Delete className="h-6 w-6" />
            ) : k === "clear" ? (
              <span className="text-sm font-bold uppercase tracking-wider">Clear</span>
            ) : (
              k
            )}
          </button>
        );
      })}
      {!phone && (
        <button
          type="button"
          onClick={() => onKey("clear")}
          className="col-span-3 h-11 rounded-2xl bg-ground text-sm font-bold uppercase tracking-wider text-muted active:bg-border"
        >
          Clear
        </button>
      )}
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
