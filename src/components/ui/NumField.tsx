"use client";

import { useState } from "react";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  value: string;
  onValue: (value: string) => void;
  /** Whole numbers only — no decimal point on the keypad's input. */
  integer?: boolean;
  /** Put the old value back when left empty. Off for a field whose empty
   *  state already means "show the computed value". */
  restoreOnBlur?: boolean;
};

/** Digits and at most one decimal point — what a price or a weight can be. */
function sanitize(raw: string, integer: boolean): string {
  const digits = raw.replace(integer ? /[^\d]/g : /[^\d.]/g, "");
  if (integer) return digits;
  const [head, ...rest] = digits.split(".");
  return rest.length ? `${head}.${rest.join("")}` : head;
}

/**
 * A number box for the till. Tapping it empties it — the old value stays
 * visible as the placeholder — so the cashier types the new number straight
 * away instead of deleting the old one first. Leaving it empty puts the old
 * value back. `inputMode` brings up the number keypad on a tablet or phone.
 */
export default function NumField({
  value,
  onValue,
  integer = false,
  restoreOnBlur = true,
  onFocus,
  onBlur,
  placeholder,
  ...rest
}: Props) {
  const [held, setHeld] = useState<string | null>(null);

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      pattern={integer ? "[0-9]*" : "[0-9]*[.]?[0-9]*"}
      autoComplete="off"
      enterKeyHint="done"
      value={value}
      placeholder={held || placeholder}
      onFocus={(e) => {
        setHeld(value);
        onValue("");
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (restoreOnBlur && e.currentTarget.value === "" && held) onValue(held);
        setHeld(null);
        onBlur?.(e);
      }}
      onChange={(e) => onValue(sanitize(e.target.value, integer))}
    />
  );
}
