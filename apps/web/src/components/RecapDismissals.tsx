import { useLibrary } from '../lib/derive.ts';
import { dismissed, undismiss, type RecapKind } from '../lib/recapSeen.ts';

const ROWS: { kind: RecapKind; label: string; what: (v: number) => string }[] = [
  { kind: 'week', label: 'Weekly recap', what: (v) => `the week of ${new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` },
  { kind: 'month', label: 'Monthly recap', what: (v) => new Date(v).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) },
  { kind: 'wrapped', label: 'Wrapped', what: (v) => String(v) },
];

/**
 * Home announces each new recap and Wrapped until you dismiss it, and a dismissal holds on every device (it is saved with your library).
 * Un-tick it here to see the announcement again, on all of them.
 */
export function RecapDismissals() {
  const lib = useLibrary();
  const d = dismissed(lib);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted">Home announces a new weekly recap, a new monthly recap (in the first days of the month) and Wrapped (from the end of November). Dismissing one hides it on every device that syncs. Un-tick to bring it back.</p>
      {ROWS.map((r) => (
        <label key={r.kind} className="flex items-center gap-2">
          <input type="checkbox" checked={d[r.kind] > 0} disabled={d[r.kind] === 0} onChange={() => undismiss(lib, r.kind)} />
          <span><b>{r.label}:</b> {d[r.kind] > 0 ? `dismissed up to ${r.what(d[r.kind])}` : 'not dismissed (shown on Home whenever there is a new one)'}</span>
        </label>))}
    </div>
  );
}
