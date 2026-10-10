import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A quantity exactly as entered — 12.345 stays 12.345, 10 stays 10 —
 *  rather than rounded to a fixed number of decimals. Floating-point noise
 *  from adding up decimals (0.1 + 0.2) is trimmed at 6 places. */
export function fmtQty(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false });
}
