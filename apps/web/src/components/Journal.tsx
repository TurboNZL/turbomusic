import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Disc3, Flame, GitMerge, Link2, Pencil, PenLine, Pin, PinOff, Plus, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import type { Library } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { logJournal } from '../lib/journal.ts';
import { statsPath } from '../lib/entityStats.ts';
import { activityGrid, groupByMonth, listeningOnThisDay, MOODS, moodOf, onThisDay, PROMPTS, writingStreak, type Entry } from '../lib/journalView.ts';
import { buildListens } from '../lib/listens.ts';
import { cn } from '../lib/cn.ts';
import { Cover } from './Cover.tsx';

const KINDS: Record<string, { label: string; Icon: typeof Plus; tone: string }> = {
  entry: { label: 'Written', Icon: PenLine, tone: 'bg-accent text-accent-fg' },
  add: { label: 'Added', Icon: Plus, tone: 'bg-good/80 text-white' },
  edit: { label: 'Changed', Icon: GitMerge, tone: 'bg-warn/80 text-white' },
  note: { label: 'Notes', Icon: StickyNote, tone: 'bg-purple-500/80 text-white' },
};
const kindOf = (t: string) => KINDS[t] ?? { label: t, Icon: Sparkles, tone: 'bg-muted/60 text-white' };

/** Whatever an entry points at (album, track, artist), as a small clickable chip with its picture. */
function resolveLink(lib: Library, id: string | null): { to: string; label: string; hash: string | null; kind: 'album' | 'artist' } | null {
  if (!id) return null;
  const al = lib.albumById.get(id); if (al) return { to: `/albums/${al.id}`, label: al.title, hash: al.cover, kind: 'album' };
  const t = lib.trackById.get(id); if (t) return { to: statsPath('track', t.id), label: t.title, hash: t.cover, kind: 'album' };
  const ar = lib.artistById.get(id); if (ar) return { to: `/artists/${id}`, label: ar.name, hash: ar.image, kind: 'artist' };
  const er = lib.eraById.get(id); if (er) return { to: `/eras/${id}`, label: er.name, hash: er.cover ?? null, kind: 'album' };
  return null;
}

function Heat({ entries }: { entries: Entry[] }) {
  const grid = useMemo(() => activityGrid(entries, 22), [entries]);
  const max = Math.max(1, ...grid.flat().map((c) => c.count ?? 0));
  return (
    <div className="flex gap-[3px]" role="img" aria-label="Entries per day over the last twenty weeks">
      {grid.map((week, w) => <div key={w} className="flex flex-col gap-[3px]">{week.map((c) => (
        <div key={c.day} title={c.count === null ? '' : `${new Date(c.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${c.count} entr${c.count === 1 ? 'y' : 'ies'}`}
          className={cn('h-3 w-3 rounded-[3px]', c.count === null ? 'opacity-0' : c.count === 0 ? 'bg-raised' : 'bg-accent')} style={c.count ? { opacity: 0.3 + 0.7 * (c.count / max) } : undefined} />))}</div>)}
    </div>
  );
}

function Composer({ lib }: { lib: Library }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const prompt = useMemo(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)], []);
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : [
    ...lib.albums.filter((a) => a.title.toLowerCase().includes(needle)).slice(0, 4).map((a) => ({ id: a.id, label: a.title, sub: a.artistName })),
    ...lib.artists.filter((a) => a.name.toLowerCase().includes(needle)).slice(0, 3).map((a) => ({ id: a.id, label: a.name, sub: 'artist' })),
    ...lib.tracks.filter((t) => t.title.toLowerCase().includes(needle)).slice(0, 4).map((t) => ({ id: t.id, label: t.title, sub: t.artistName })),
  ];
  const linked = resolveLink(lib, link);
  const submit = () => {
    if (!title.trim()) return;
    logJournal('entry', title.trim(), text.trim(), link, { mood });
    setTitle(''); setText(''); setMood(null); setLink(null); setQ(''); setOpen(false);
  };
  return (
    <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input className="input !text-base" placeholder={prompt} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setOpen(true)} />
      {(open || title) && <>
        <textarea className="input" rows={3} placeholder="Say more (optional)… ⌘/Ctrl + Enter to save" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mood">{MOODS.map((m) => (
          <button type="button" key={m.id} aria-pressed={mood === m.id} onClick={() => setMood(mood === m.id ? null : m.id)}
            className={cn('rounded-full border px-2.5 py-1 text-xs transition-transform', mood === m.id ? 'scale-105 border-accent bg-accent/20' : 'border-line text-muted hover:text-fg')}><span className="mr-1">{m.emoji}</span>{m.label}</button>))}</div>
        <div className="flex flex-wrap items-start gap-2">
          {linked ? <span className="chip inline-flex items-center gap-1.5 !text-fg"><Link2 size={12} />{linked.label}<button type="button" aria-label="Unlink" onClick={() => setLink(null)}><X size={12} /></button></span>
            : <div className="relative min-w-0 flex-1 basis-56"><input className="input !py-1.5 text-sm" placeholder="Link an album, artist or track (optional)" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-theme border border-line bg-surface shadow-xl">{hits.map((h) => (
                <button type="button" key={h.id} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-raised" onClick={() => { setLink(h.id); setQ(''); }}><span className="truncate">{h.label}</span><span className="shrink-0 text-xs text-muted">{h.sub}</span></button>))}</div>}</div>}
          <button className="btn btn-accent ml-auto" disabled={!title.trim()}><PenLine size={15} />Add to the journal</button>
        </div></>}
    </form>
  );
}

function EntryCard({ e, lib, onPin, onDelete }: { e: Entry; lib: Library; onPin: () => void; onDelete: () => void }) {
  const k = kindOf(e.type), mood = moodOf(e.mood), link = resolveLink(lib, e.entityId);
  return (
    <article className="group relative flex gap-3">
      <div className={cn('z-10 mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full shadow', k.tone)}><k.Icon size={15} /></div>
      <div className={cn('card min-w-0 flex-1 p-3.5', e.pinned && 'border-accent')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{new Date(e.timestamp).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span className="uppercase tracking-wider">{k.label}</span>
          {mood && <span className="rounded-full bg-raised px-2 py-0.5 text-fg">{mood.emoji} {mood.label}</span>}
          <span className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
            <button aria-label={e.pinned ? 'Unpin' : 'Pin'} title={e.pinned ? 'Unpin' : 'Pin to the top'} className="hover:text-fg" onClick={onPin}>{e.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
            <button aria-label="Delete entry" className="hover:text-bad" onClick={onDelete}><Trash2 size={13} /></button></span>
        </div>
        <div className="mt-1 text-sm font-semibold">{e.title}</div>
        {e.description && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{e.description}</p>}
        {link && <Link to={link.to} className="mt-2 flex w-fit max-w-full items-center gap-2 rounded-theme bg-raised/70 py-1 pl-1 pr-3 text-xs hover:bg-raised"><Cover hash={link.hash} seed={link.label} kind={link.kind} className="h-8 w-8 shrink-0" /><span className="truncate">{link.label}</span></Link>}
      </div>
    </article>
  );
}

/** The curation journal: write entries with a mood and a linked album, artist or track; automatic entries (imports, merges) share the same timeline. */
export function Journal({ lib }: { lib: Library }) {
  const remove = useStore((s) => s.remove);
  const patch = useStore((s) => s.patch);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [mood, setMood] = useState<string | null>(null);
  const [shown, setShown] = useState(20);
  const all = useMemo<Entry[]>(() => lib.timeline.map((r) => ({ ...r })), [lib]);
  const kinds = useMemo(() => { const m = new Map<string, number>(); for (const e of all) m.set(e.type, (m.get(e.type) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all]);
  const needle = q.trim().toLowerCase();
  const filtered = all.filter((e) => (kind === 'all' || e.type === kind) && (!mood || e.mood === mood) && (!needle || `${e.title} ${e.description ?? ''}`.toLowerCase().includes(needle)));
  const pinned = filtered.filter((e) => e.pinned).sort((a, b) => b.timestamp - a.timestamp);
  const groups = useMemo(() => groupByMonth(filtered.filter((e) => !e.pinned)), [filtered]);
  const streak = writingStreak(all);
  const monthCount = all.filter((e) => { const d = new Date(e.timestamp), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }).length;
  const written = all.filter((e) => e.type === 'entry').length;
  const today = useMemo(() => onThisDay(all), [all]);
  const listens = useMemo(() => buildListens(lib), [lib]);
  const heard = useMemo(() => listeningOnThisDay(listens).slice(0, 3), [listens]);
  let count = 0;
  const cut = (items: Entry[]) => { const take = items.slice(0, Math.max(0, shown - count)); count += take.length; return take; };
  const del = (e: Entry) => confirm('Delete this entry?') && remove('timeline', e.id);
  const pin = (e: Entry) => patch('timeline', e.id, { pinned: !e.pinned });

  return (
    <section className="space-y-4" aria-label="Curation journal">
      <div className="card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full bg-accent/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-xl font-bold"><Disc3 size={20} className="text-accent" />Curation journal</h2>
            <p className="text-sm text-muted">Your thoughts on the library, plus everything you add and change, in one timeline.</p>
            <div className="flex flex-wrap gap-2 pt-2 text-xs">
              <span className="rounded-full bg-raised px-3 py-1"><b className="tabular-nums">{all.length}</b> entries</span>
              <span className="rounded-full bg-raised px-3 py-1"><b className="tabular-nums">{written}</b> written by you</span>
              <span className="rounded-full bg-raised px-3 py-1"><b className="tabular-nums">{monthCount}</b> this month</span>
              {streak > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-3 py-1"><Flame size={13} className="text-accent" /><b className="tabular-nums">{streak}</b> day streak</span>}
            </div>
          </div>
          <div className="max-w-full overflow-x-auto pb-1"><Heat entries={all} /></div>
        </div>
      </div>

      <Composer lib={lib} />

      {(today.length > 0 || heard.length > 0) && (
        <div className="card space-y-2 p-4" style={{ background: 'linear-gradient(135deg, hsl(var(--accent) / 0.14), transparent 60%)' }}>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={15} className="text-accent" />On this day</h3>
          {today.slice(0, 3).map((e) => <div key={e.id} className="text-sm"><span className="text-muted">{new Date(e.timestamp).getFullYear()}: </span><b>{e.title}</b>{e.description && <span className="text-muted"> — {e.description.slice(0, 120)}</span>}</div>)}
          {heard.map((h) => { const t = lib.trackById.get(h.trackId); return t ? <div key={h.year} className="text-sm"><span className="text-muted">{h.year}, you were playing </span><Link to={statsPath('track', t.id)} className="font-semibold hover:underline">{t.title}</Link><span className="text-muted"> by {t.artistName} ({h.plays} plays)</span></div> : null; })}
        </div>)}

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input !w-56 max-w-full" placeholder="Search the journal…" aria-label="Search the journal" value={q} onChange={(e) => { setQ(e.target.value); setShown(20); }} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
            <Pill on={kind === 'all'} onClick={() => { setKind('all'); setShown(20); }}>All {all.length}</Pill>
            {kinds.map(([t, n]) => <Pill key={t} on={kind === t} onClick={() => { setKind(kind === t ? 'all' : t); setShown(20); }}>{kindOf(t).label} {n}</Pill>)}</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Mood filter">{MOODS.filter((m) => all.some((e) => e.mood === m.id)).map((m) => <Pill key={m.id} on={mood === m.id} onClick={() => { setMood(mood === m.id ? null : m.id); setShown(20); }}>{m.emoji}</Pill>)}</div>
          {(q || kind !== 'all' || mood) && <span className="text-xs text-muted">{filtered.length} of {all.length}</span>}
        </div>)}

      {!all.length && <div className="card flex flex-col items-center gap-2 p-8 text-center"><Pencil size={22} className="text-accent" /><p className="text-sm text-muted">Nothing here yet. Write the first entry above; imports, merges and new albums will appear by themselves.</p></div>}
      {all.length > 0 && !filtered.length && <p className="text-sm text-muted">No entries match.</p>}

      <div className="relative space-y-6">
        <div className="pointer-events-none absolute bottom-2 left-4 top-2 w-px bg-line" aria-hidden />
        {pinned.length > 0 && <div className="space-y-3"><h3 className="relative z-10 flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-wider text-accent"><Pin size={13} />Pinned</h3>{cut(pinned).map((e) => <EntryCard key={e.id} e={e} lib={lib} onPin={() => pin(e)} onDelete={() => del(e)} />)}</div>}
        {groups.map((g) => { const items = cut(g.entries); return items.length ? (
          <div key={g.key} className="space-y-3">
            <h3 className="relative z-10 -ml-1 w-fit rounded-full bg-raised px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-muted">{g.label} <span className="text-muted/70">· {g.entries.length}</span></h3>
            {items.map((e) => <EntryCard key={e.id} e={e} lib={lib} onPin={() => pin(e)} onDelete={() => del(e)} />)}
          </div>) : null; })}
      </div>
      {shown < filtered.length && <button className="btn" onClick={() => setShown(shown + 20)}>Show more</button>}
    </section>
  );
}

const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={onClick} className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', on ? 'border-accent bg-accent/20 text-fg' : 'border-line text-muted hover:text-fg')}>{children}</button>
);
