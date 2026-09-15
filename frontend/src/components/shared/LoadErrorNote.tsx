// src/components/shared/LoadErrorNote.tsx
//
// Small, consistent "this piece of data failed to load" note with a Retry
// action. Used across the app wherever a query's queryFn used to
// `.catch(() => [])` / `.catch(() => null)` — swallowing a failed fetch
// into an empty/null default made it indistinguishable from "genuinely
// nothing here", with no visible indication anything went wrong and no way
// to recover short of a full page reload. Now the query lets the error
// through (so React Query's own state — and the axios-layer retry for
// transient network blips — works as intended) and the page renders this
// instead of silently pretending the data is empty.
import { AlertCircle } from 'lucide-react';

export function LoadErrorNote({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2 text-xs text-red-600 dark:text-red-400">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">Couldn't load {label} — connection or server problem.</span>
      <button onClick={onRetry} className="font-semibold hover:underline flex-shrink-0">
        Retry
      </button>
    </div>
  );
}
