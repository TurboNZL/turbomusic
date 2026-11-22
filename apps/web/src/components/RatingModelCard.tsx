import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLibrary } from '../lib/derive.ts';
import { Cover } from './Cover.tsx';
import { updateProfile } from '../lib/profile.ts';

const MODELS = [
  { id: 'preference', label: 'Preference fit (new)', text: 'Every vote you ever cast is weighed together. The order you voted in does not matter, an old “this beats that” keeps its weight, contradictions are settled by the evidence, and a song with few votes stays near the middle until its votes say otherwise. Thumbs add a small bonus behind the scenes. Ratings follow a bell curve with your best song as the 10.' },
  { id: 'elo', label: 'Classic Elo', text: 'Votes are replayed one at a time, each moving the two songs a little. Simple and familiar, but the top of the list moves with every vote and an old vote fades as new ones stack on it. Ratings are stretched between your worst (0) and best (10) song.' },
] as const;

/** Settings > Library: which maths turns your votes into ratings. Saved with the library, so it holds on every device. */
export function RatingModelCard() {
  const lib = useLibrary();
  const now = lib.profile?.settings?.ratingModel === 'elo' ? 'elo' : 'preference';
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Your votes are never changed, only how they become ratings. You can switch back and forth: nothing is lost.</p>
      {MODELS.map((m) => (
        <label key={m.id} className="flex items-start gap-2">
          <input type="radio" name="rating-model" className="mt-0.5" checked={now === m.id} onChange={() => updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, ratingModel: m.id } }))} />
          <span><b>{m.label}</b><br /><span className="text-muted">{m.text}</span></span>
        </label>))}
    </div>
  );
}

/**
 * "Draw the 10/10 line": the ranked list of your songs, best first, with a line you place under the last song you would call a 10/10.
 * That song and everything above it rate 10; the songs below are stretched to fill the rest (see `bend` in lib/library.ts). Saved with
 * the library. Without a line the best song rates 10 and the rest follow the curve of your votes, which can leave favourites in the sevens.
 */
export function TenLineCard() {
  const lib = useLibrary(true);
  const [q, setQ] = useState('');
  const line = typeof lib.profile?.settings?.tenLine === 'string' ? lib.profile.settings.tenLine : null;
  const ranked = useMemo(() => lib.tracks.filter((t) => t.comparisons > 0 && !t.versionOf).sort((a, b) => b.elo - a.elo), [lib]);
  const at = line ? ranked.findIndex((t) => t.id === line) : -1;
  const f = q.trim().toLowerCase();
  const shown = f ? ranked.map((t, i) => ({ t, i })).filter(({ t }) => `${t.title} ${t.artistName}`.toLowerCase().includes(f)).slice(0, 60) : ranked.map((t, i) => ({ t, i })).slice(Math.max(0, (at < 0 ? 0 : at) - 8), (at < 0 ? 0 : at) + 40);
  const set = (id: string | null) => updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, tenLine: id } }));
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Pick the last song you would still call a 10/10. It and everything above it rate 10; the rest are stretched to fill the scale under it. Your votes never change.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>{at >= 0 ? <>The line is under <b>{ranked[at].title}</b> (#{at + 1}): {at + 1} song{at === 0 ? '' : 's'} rate 10.</> : 'No line: the best song rates 10 and the rest follow your votes.'}</span>
        {line && <button className="btn btn-ghost !py-1 text-xs" onClick={() => set(null)}><X size={13} />Remove the line</button>}
      </div>
      <label className="relative block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input w-full !py-1.5 !pl-9 text-sm" placeholder="Search your ranked songs" aria-label="Search your ranked songs" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <ol className="max-h-80 overflow-y-auto rounded-theme border border-line">
        {shown.map(({ t, i }) => (
          <li key={t.id} className={i === at ? 'border-b-4 border-accent' : 'border-b border-line/50'}>
            <button type="button" className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-raised/60" onClick={() => set(t.id)} title="Put the line under this song">
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">#{i + 1}</span>
              <Cover hash={t.cover} seed={t.albumTitle ?? t.title} className="h-8 w-8 shrink-0" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="block truncate text-xs text-muted">{t.artistName}</span></span>
              {i === at && <span className="chip !text-accent">last 10/10</span>}
            </button>
          </li>))}
        {!shown.length && <li className="px-3 py-3 text-muted">No ranked song matches.</li>}
      </ol>
    </div>
  );
}
