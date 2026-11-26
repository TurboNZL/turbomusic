import { Select } from './Select.tsx';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { originFor } from '../lib/pointer.ts';
import { FileAudio, ImagePlus, Info, Plus, X } from 'lucide-react';
import type { ArtistData, Credit, EraData } from '@turbomusic/core';
import { useLibrary } from '../lib/derive.ts';
import { AUDIO_ACCEPT, FEATURED_ROLE, hasLead, isFeatured, LEAD_ROLE } from '../lib/defaults.ts';
import { saveAudio, saveImage } from '../lib/files.ts';
import { useStore } from '../lib/store.ts';
import { Cover } from './Cover.tsx';

/** Inside this provider a Modal draws itself in the page (a card with its title bar and footer) instead of floating over it. Used by the stats pages' pencil. */
export const InlineModals = createContext(false);

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const inline = useContext(InlineModals);
  useEffect(() => {
    if (inline) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, inline]);
  // the dialog grows out of the control that opened it
  const win = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (win.current && !inline) win.current.style.transformOrigin = originFor(win.current.getBoundingClientRect()); }, []);
  if (inline) {
    return (
      <section role="region" aria-label={title} className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-semibold">{title}</h2>
          <button className="btn btn-ghost !p-1.5" aria-label="Close editor" onClick={onClose}><X size={18} /></button></div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </section>
    );
  }
  return (
    <div className="bt-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={win} role="dialog" aria-label={title} className={`bt-window flex max-h-[92vh] w-full flex-col overflow-hidden ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <div className="bt-titlebar flex items-center"><h2 className="font-semibold">{title}</h2>
          <button className="bt-close" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        <div className="bt-body grid grid-flow-row-dense grid-cols-1 content-start gap-x-5 gap-y-4 overflow-y-auto p-5 sm:grid-cols-2 [&>*]:col-span-full [&>[data-half]]:col-span-1">{children}</div>
        {footer && <div className="bt-footer flex items-center gap-2 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * A labelled field. The hint is kept out of the way: an (i) beside the label, and the sentence opens under the field while you are in it (hovering the
 * label shows it as a tooltip), so a dialog is not a wall of small print. `half` lets two short fields share a row in a wide dialog.
 */
export function Field({ label, children, hint, half }: { label: string; children: ReactNode; hint?: string; half?: boolean }) {
  return (
    <label className="group block space-y-1 text-sm" data-half={half || undefined} title={hint}>
      <span className="bt-label flex items-center gap-1.5 text-muted">{label}{hint && <Info size={12} className="shrink-0 opacity-60" aria-hidden />}</span>
      {children}
      {hint && <span className="block max-h-0 overflow-hidden text-xs text-muted opacity-0 transition-all duration-200 group-focus-within:max-h-24 group-focus-within:opacity-100">{hint}</span>}
    </label>
  );
}

/** Chips with suggestions from the existing genre list; unknown names are created as genre records on save. */
export function TagInput({ value, onChange, suggestions, placeholder = 'Add genre, press Enter' }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[]; placeholder?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const v = raw.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, suggestions.find((s) => s.toLowerCase() === v.toLowerCase()) ?? v]);
    setText('');
  };
  const options = suggestions.filter((s) => !value.includes(s) && s.toLowerCase().includes(text.toLowerCase())).slice(0, 6);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">{value.map((g) => (
        <span key={g} className="chip gap-1 !text-fg">{g}<button type="button" aria-label={`Remove ${g}`} onClick={() => onChange(value.filter((x) => x !== g))}><X size={12} /></button></span>))}</div>
      <input className="input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} />
      {text && <div className="flex flex-wrap gap-1.5">{options.map((o) => <button key={o} type="button" className="chip hover:bg-line" onClick={() => add(o)}>{o}</button>)}</div>}
    </div>
  );
}

/** Pick an artist by searching; a name that does not exist is offered as "Create artist: …" at the top of the results. */
export function ArtistSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  const sorted = [...lib.artists].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Select value={value} onChange={onChange} placeholder="Search artists…" searchable
      options={[...(!lib.artistById.has(value) && value ? [{ value, label: '(unknown artist)' }] : []), ...sorted.map((a) => ({ value: a.id, label: a.name, hint: a.aliases?.length ? `aka ${a.aliases.slice(0, 2).join(', ')}` : undefined }))]}
      creatable={{ label: (n) => `Create artist: “${n}”`, create: (n) => put('artists', { name: n, image: null } satisfies ArtistData) }} />
  );
}

/** Choose / replace an image; the file is resized, hashed and stored locally, then uploaded when a server is available. */
export function ImagePicker({ hash, onChange, seed, kind = 'album', removeLabel = 'Remove' }: { hash: string | null; onChange: (hash: string | null) => void; seed: string; kind?: 'album' | 'artist'; removeLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-4">
      <Cover hash={hash} seed={seed} kind={kind} className="w-24 shrink-0" />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} />{busy ? 'Saving…' : hash ? 'Replace' : 'Choose image'}</button>
          {hash && <button type="button" className="btn btn-ghost" onClick={() => onChange(null)}>{removeLabel}</button>}
        </div>
        {err && <div className="text-xs text-bad">{err}</div>}
        <input ref={input} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setBusy(true); setErr(null);
          try { onChange(await saveImage(f)); } catch { setErr('Could not read that image.'); } finally { setBusy(false); }
        }} />
      </div>
    </div>
  );
}

/** Choose / replace a track's audio file from this device; it is hashed, kept locally and uploaded on the next sync. */
export function AudioPicker({ hash, onChange }: { hash: string | null; onChange: (file: string | null, bitrate: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><FileAudio size={15} />{busy ? 'Reading…' : hash ? 'Replace audio file' : 'Choose audio file'}</button>
        {hash && <button type="button" className="btn btn-ghost" onClick={() => { setName(null); onChange(null, null); }}>Remove</button>}
        <span className="min-w-0 truncate text-xs text-muted">{name ?? (hash ? 'Audio attached' : 'No audio yet')}</span>
      </div>
      {err && <div className="text-xs text-bad">{err}</div>}
      <input ref={input} type="file" accept={AUDIO_ACCEPT} hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        setBusy(true); setErr(null);
        try { const r = await saveAudio(f); setName(f.name); onChange(r.hash, r.bitrate); } catch { setErr('Could not read that file.'); } finally { setBusy(false); }
      }} />
    </div>
  );
}

/** Search-and-pick a track (for playback rules). */
export function TrackPicker({ value, onChange, exclude }: { value: string | null; onChange: (id: string | null) => void; exclude?: string }) {
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const chosen = value ? lib.trackById.get(value) : null;
  const matches = q.length > 1 ? lib.tracks.filter((t) => t.id !== exclude && `${t.title} ${t.artistName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  if (chosen) return <div className="flex items-center gap-2 rounded-theme bg-raised px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{chosen.title} <span className="text-muted">· {chosen.artistName}</span></span>
    <button type="button" className="text-muted hover:text-fg" aria-label="Clear" onClick={() => onChange(null)}><X size={15} /></button></div>;
  return <div className="relative"><input className="input" placeholder="Search for a track…" value={q} onChange={(e) => setQ(e.target.value)} />
    {matches.length > 0 && <div className="card absolute z-10 mt-1 w-full overflow-hidden shadow-xl">{matches.map((t) => (
      <button key={t.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { onChange(t.id); setQ(''); }}>{t.title} <span className="text-muted">· {t.artistName}</span></button>))}</div>}</div>;
}

/**
 * Who worked on a track/album and in what role. This is the only place an artist is entered: the primary
 * artist is the first "Lead artist" credit. With `requireLead`, a missing lead credit is called out inline.
 */
export function CreditsEditor({ value, onChange, requireLead, readOnly }: { value: Credit[]; onChange: (v: Credit[]) => void; requireLead?: boolean; readOnly?: boolean }) {
  const lib = useLibrary();
  const set = (i: number, c: Credit) => onChange(value.map((x, j) => (j === i ? c : x)));
  if (readOnly) return (
    <div className="space-y-1.5">{value.map((c, i) => (
      <div key={i} className="flex flex-wrap items-center gap-2 rounded-theme bg-raised px-3 py-2 text-sm"><span className="font-medium">{lib.artistById.get(c.artistId)?.name ?? '(unknown artist)'}</span>
        {c.role.map((r) => <span key={r} className="chip">{r}</span>)}</div>))}</div>
  );
  return (
    <div className="space-y-3">
      {value.map((c, i) => (
        <div key={i} className="space-y-2 rounded-theme border border-line p-3">
          <div className="flex items-start gap-2"><div className="flex-1"><ArtistSelect value={c.artistId} onChange={(id) => set(i, { ...c, artistId: id })} /></div>
            <button type="button" className="btn btn-ghost !p-2" aria-label="Remove credit" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={15} /></button></div>
          <TagInput placeholder="Add role, press Enter" value={c.role} onChange={(role) => set(i, { ...c, role })} suggestions={lib.roles.map((r) => r.name)} />
        </div>))}
      {requireLead && !hasLead(value) && <div role="alert" className="rounded-theme bg-warn/15 p-3 text-sm text-warn">Add a credit with the role “{LEAD_ROLE}”. That is how the artist is set.</div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => onChange([...value, { artistId: '', role: [LEAD_ROLE] }])}><Plus size={15} />Add lead artist</button>
        <button type="button" className="btn" onClick={() => onChange([...value, { artistId: '', role: [FEATURED_ROLE] }])}><Plus size={15} />Add featured artist</button>
        <button type="button" className="btn" onClick={() => onChange([...value, { artistId: '', role: [] }])}><Plus size={15} />Add credit</button>
      </div>
    </div>
  );
}

/**
 * The featured artists of a track that follows its album's credits: only these are the track's own, so they can be added without
 * unticking "Use the album's credits". Works on the same credit list the track stores; other credits in it are left alone.
 */
export function FeaturedEditor({ value, onChange }: { value: Credit[]; onChange: (v: Credit[]) => void }) {
  const mine = value.map((c, i) => ({ c, i })).filter(({ c }) => isFeatured(c) || (!c.artistId && c.role.includes(FEATURED_ROLE)));
  return (
    <div className="space-y-2">
      {mine.map(({ c, i }) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1"><ArtistSelect value={c.artistId} onChange={(id) => onChange(value.map((x, j) => (j === i ? { ...x, artistId: id } : x)))} /></div>
          <button type="button" className="btn btn-ghost !p-2" aria-label="Remove featured artist" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={15} /></button>
        </div>))}
      <button type="button" className="btn" onClick={() => onChange([...value, { artistId: '', role: [FEATURED_ROLE] }])}><Plus size={15} />Add featured artist</button>
    </div>
  );
}

/** Search artists, albums and tracks and pick one (for bios). */
export function EntityPicker({ onPick }: { onPick: (e: { type: 'artist' | 'album' | 'track' | 'era' | 'playlist'; id: string }) => void }) {
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const n = q.trim().toLowerCase();
  const hits = n.length < 2 ? [] : [
    ...lib.artists.filter((a) => [a.name, ...(a.aliases ?? [])].some((x) => x.toLowerCase().includes(n))).map((a) => ({ type: 'artist' as const, id: a.id, label: a.name })),
    ...lib.eras.filter((a) => a.name.toLowerCase().includes(n)).map((a) => ({ type: 'era' as const, id: a.id, label: a.name })),
    ...lib.albums.filter((a) => a.title.toLowerCase().includes(n)).map((a) => ({ type: 'album' as const, id: a.id, label: a.title })),
    ...lib.playlists.filter((p) => p.name.toLowerCase().includes(n)).map((p) => ({ type: 'playlist' as const, id: p.id, label: p.name })),
    ...lib.tracks.filter((t) => `${t.title} ${t.artistName}`.toLowerCase().includes(n)).map((t) => ({ type: 'track' as const, id: t.id, label: `${t.title} · ${t.artistName}` })),
  ].slice(0, 8);
  // the results open below the box, often under the fold of the dialog: bring them into view as soon as there are some
  const results = useRef<HTMLDivElement>(null);
  const shown = hits.length;
  useEffect(() => { if (shown) results.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [shown, n]);
  return <div className="relative"><input className="input" placeholder="Tie it to an artist, era, album, track or playlist…" value={q} onChange={(e) => setQ(e.target.value)} />
    {hits.length > 0 && <div ref={results} className="card absolute z-10 mt-1 w-full overflow-hidden shadow-xl">{hits.map((h) => (
      <button key={`${h.type}${h.id}`} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-raised" onClick={() => { onPick(h); setQ(''); }}>
        <span className="chip">{h.type}</span><span className="truncate">{h.label}</span></button>))}</div>}</div>;
}

/** The eras something is in: chips, and a search that can create a new era. Eras overlap, so there can be several. */
export function EraPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const lib = useLibrary();
  const put = useStore((s) => s.put);
  const eras = [...lib.eras].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-2">
      {value.length > 0 && <div className="flex flex-wrap gap-1.5">{value.map((id) => (
        <span key={id} className="chip gap-1 !text-fg">{lib.eraById.get(id)?.name ?? '(deleted era)'}<button type="button" aria-label="Take out of this era" onClick={() => onChange(value.filter((x) => x !== id))}><X size={12} /></button></span>))}</div>}
      <Select value="" placeholder={value.length ? 'Add to another era…' : 'Add to an era…'} searchable onChange={(id) => id && !value.includes(id) && onChange([...value, id])}
        options={eras.filter((e) => !value.includes(e.id)).map((e) => ({ value: e.id, label: e.name }))}
        creatable={{ label: (n) => `Create era: “${n}”`, create: (n) => put('eras', { name: n, description: null, cover: null, albumIds: [], trackIds: [], playlistIds: [] } satisfies EraData) }} />
    </div>
  );
}
