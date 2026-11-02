import type { InputHTMLAttributes } from "react";

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode">;

// Money field: a text input with the decimal keypad, so "12,5" (French phone
// keyboards) and "12.5" both work -- a type="number" input rejects or drops
// the decimal comma depending on browser and locale. Parse the value with
// parseAmount (lib/money.ts); numberSchema already accepts both separators.
export function AmountInput(props: AmountInputProps) {
  return <input type="text" inputMode="decimal" autoComplete="off" {...props} />;
}
