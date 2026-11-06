"use client";

import { useState } from "react";
import NumPad, { applyKey } from "@/components/ui/NumPad";

/**
 * One number, typed on the on-screen pad — a quantity, a price or a delivery
 * charge on an order. The first key replaces the old value, as on the till.
 */
export default function PadSheet({
  title,
  hint,
  initial,
  decimals,
  prefix,
  suffix,
  allowZero = false,
  onDone,
  onClose,
}: {
  title: string;
  hint?: string;
  initial: number;
  decimals: number;
  prefix?: string;
  suffix?: string;
  allowZero?: boolean;
  onDone: (value: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial ? String(initial) : "");
  const [fresh, setFresh] = useState(true);
  const value = text === "" ? 0 : Number(text);
  const ok = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex w-full max-w-sm flex-col gap-3 rounded-t-3xl bg-surface p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-extrabold">{title}</h3>
          {hint && <p className="text-sm font-medium text-muted">{hint}</p>}
        </div>
        <div className="tabular-nums flex min-h-[64px] items-center justify-end gap-2 rounded-2xl border-2 border-accent bg-ground px-4 text-3xl font-extrabold">
          {prefix && <span className="text-lg font-bold text-muted">{prefix}</span>}
          <span className={text ? "" : "text-muted-2"}>{text || (fresh && initial ? String(initial) : "0")}</span>
          {suffix && <span className="text-lg font-bold text-muted">{suffix}</span>}
        </div>
        <NumPad
          allowDecimal={decimals > 0}
          onKey={(k) => {
            setText((t) => applyKey(t, k, { fresh, decimals }));
            setFresh(false);
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[52px] flex-1 rounded-2xl border border-border text-base font-bold text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onDone(Math.round(value * 10 ** decimals) / 10 ** decimals)}
            className="min-h-[52px] flex-[2] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
