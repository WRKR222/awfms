import { useEffect, useState, type InputHTMLAttributes } from 'react';

/** A number box that keeps exactly what's typed while typing ("0.", "0.05",
 *  "1.250"), instead of re-rendering the parsed number — which drops a
 *  trailing "." or "0" and makes values like 0.05 impossible to type. */
export function DecimalInput({ value, onValueChange, ...rest }: {
  value: number;
  onValueChange: (n: number) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState(value ? String(value) : '');
  // Follow outside changes (e.g. a prefilled plan) without clobbering typing.
  useEffect(() => {
    if ((parseFloat(text) || 0) !== (value || 0)) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={e => {
        const next = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(next)) return;
        setText(next);
        onValueChange(parseFloat(next) || 0);
      }}
    />
  );
}
