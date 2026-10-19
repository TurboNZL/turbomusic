import { useState } from 'react';
import { CalendarCheck, CheckCircle2, ChevronDown, ClipboardPaste, Eraser, GitMerge, ImageDown, Search, X } from 'lucide-react';
import { HealthHero } from '../components/HealthHero.tsx';
import { AudioQualityCard, MissingAudioCard } from '../components/AudioTools.tsx';
import { AlbumSuggestions } from '../components/AlbumSuggestions.tsx';
import { QuickFix } from '../components/HealthQuick.tsx';
import { BulkLinks } from '../components/BulkLinks.tsx';
import type { LinkKind } from '../lib/bulkLinks.ts';
import { fetchCoverFromLinks } from '../lib/cover.ts';
import { thumbnailUrls, youtubeId } from '../lib/youtube.ts';
import { computeHealth, dupeSignature, ignoredDupes, type HealthItem } from '../lib/health.ts';
import { updateProfile } from '../lib/profile.ts';
import { useLibraryLive } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { useStore } from '../lib/store.ts';
import { cn } from '../lib/cn.ts';
import { withoutLegacyArtist } from '../lib/defaults.ts';
import type { Credit } from '@turbomusic/core';

/** One album that is waiting for its YouTube link: paste it and the import-into-album screen opens already looked up. */
function AlbumLinkRow({ item }: { item: HealthItem }) {
  const edit = useEditor((s) => s.open);
  const [url, setUrl] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
      <button className="min-w-0 flex-1 basis-48 truncate text-left hover:underline" onClick={() => edit({ kind: 'album', id: item.id })}>{item.label}{item.detail && <span className="text-xs text-muted"> · {item.detail}</span>}</button>
      <input className="input !w-72 max-w-full !py-1 text-xs" placeholder="Paste a YouTube Music album link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && edit({ kind: 'import-into-album', id: item.id, url: url.trim() })} />
      <button className="btn !py-1 text-xs" disabled={!url.trim()} onClick={() => edit({ kind: 'import-into-album', id: item.id, url: url.trim() })}>Import</button>
    </div>
  );
}

export function HealthPage() {
  const lib = useLibraryLive();
  const edit = useEditor((s) => s.open);
  const remove = useStore((s) => s.remove);
  const [open, setOpen] = useState<string | null>(null);
  const patch = useStore((s) => s.patch);
  const put = useStore((s) => s.put);
  const configured = useStore((s) => !!s.settings.token);
  const [covers, setCovers] = useState<{ running: boolean; done: number; total: number; failed: number } | null>(null);
  const [bulk, setBulk] = useState<LinkKind | null>(null);
  const checks = computeHealth(lib);

  /** Best effort: use the first track's YouTube thumbnail as the cover. Failures are skipped, never fatal. */
  async function fillCovers(albumIds: string[]) {
    const todo = albumIds.flatMap((id) => {
      const album = lib.albumById.get(id);
      const vid = album?.trackIds.map((t) => youtubeId(lib.trackById.get(t)?.youtubeMusicUrl)).find(Boolean);
      return vid ? [{ id, vid }] : [];
    });
    setCovers({ running: true, done: 0, total: todo.length, failed: 0 });
    let done = 0, failed = 0;
    for (const { id, vid } of todo) {
      try {
        const hash = await fetchCoverFromLinks(thumbnailUrls(vid));
        const raw = useStore.getState().rows.albums.get(id)?.data as { covers?: string[] } | undefined;
        patch('albums', id, { covers: [...(raw?.covers ?? []), hash] }); // into the pool; the album shows it until a release has its own
      } catch { failed++; }
      setCovers({ running: true, done: ++done, total: todo.length, failed });
    }
    setCovers({ running: false, done, total: todo.length, failed });
  }
  /** write a Lead artist credit onto records whose only artist is a stored (legacy) artistId, then drop that field */
  function addLeadCredits(items: HealthItem[]) {
    for (const i of items) {
      const table = i.kind === 'album' ? 'albums' : 'tracks';
      const d = useStore.getState().rows[table].get(i.id)?.data as { credits?: Credit[]; artistId?: string } | undefined;
      if (!d) continue;
      const next = withoutLegacyArtist(d);
      if (next) put(table, next, i.id);
    }
  }
  const problems = checks.filter((c) => c.items.length);
  const openItem = (i: HealthItem) => (i.kind === 'track' || i.kind === 'album' || i.kind === 'artist' || i.kind === 'release') && edit({ kind: i.kind, id: i.id });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <HealthHero lib={lib} problems={problems.length} total={checks.length} />
      <div className="grid gap-4 md:grid-cols-2"><MissingAudioCard /><AudioQualityCard /></div>
      <AlbumSuggestions />
      {checks.map((c) => (
        <section key={c.id} className="card overflow-hidden">
          <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            {c.items.length ? <span className="min-w-8 rounded-full bg-warn/20 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-warn">{c.items.length}</span> : <CheckCircle2 size={18} className="text-good" />}
            <span className="flex-1 text-sm font-medium">{c.title}</span>
            {c.items.length > 0 && <ChevronDown size={16} className={cn('text-muted transition-transform', open === c.id && 'rotate-180')} />}
          </button>
          {open === c.id && c.items.length > 0 && (
            <div className="border-t border-line">
              <p className="px-4 py-2 text-xs text-muted">{c.why}</p>
              {c.id === 'album-no-cover' && <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
                <button className="btn" disabled={!configured || covers?.running} onClick={() => void fillCovers(c.items.map((i) => i.id))}><ImageDown size={15} />Try YouTube thumbnails</button>
                <span className="text-xs text-muted">{!configured ? 'Needs a server (Settings).' : covers ? `${covers.done}/${covers.total} done${covers.failed ? `, ${covers.failed} failed` : ''}${covers.running ? '…' : ''}` : 'Uses each album\'s first track link. Check the results; replace any that look wrong.'}</span></div>}
              {(c.bulk || c.matchLinks) && <div className="flex flex-wrap gap-2 px-4 pb-2">{c.matchLinks && <button className="btn btn-accent" onClick={() => edit({ kind: 'match-links', id: '' })}><Search size={15} />Find YouTube Music albums</button>}{c.bulk && <button className="btn" onClick={() => setBulk(c.bulk!)}><ClipboardPaste size={15} />Paste links by album</button>}</div>}
              {c.clearDead && <div className="px-4 pb-2"><button className="btn" onClick={() => confirm(`Forget the dead-link mark on ${c.items.length} tracks?`) && c.items.forEach((i) => patch('tracks', i.id, { youtubeDead: null }))}><Eraser size={15} />Forget these marks</button></div>}
              {c.autoDates && <div className="px-4 pb-2"><button className="btn btn-accent" onClick={() => edit({ kind: 'find-dates', id: '' })}><CalendarCheck size={15} />Find dates automatically</button></div>}
              {c.addLead && <div className="px-4 pb-2"><button className="btn" onClick={() => confirm(`${c.addLead!.label} (${c.items.length})?`) && addLeadCredits(c.items)}>{c.addLead.label}</button></div>}
              {c.fix && <div className="px-4 pb-2"><button className="btn text-bad" onClick={() => confirm(`${c.fix!.label} (${c.items.length})?`) && c.items.forEach((i) => remove(c.fix!.table, i.id))}>{c.fix.label}</button></div>}
              {c.quick ? <QuickFix check={c} /> :
              c.mergeGroups ? <div className="max-h-[28rem] space-y-2 overflow-y-auto px-4 pb-3">{[...new Set(c.items.map((i) => i.group))].slice(0, 100).map((g) => { const group = c.items.filter((i) => i.group === g); return (
                <div key={g} className="rounded-theme border border-line">
                  {group[0]?.note && <div className="border-b border-line/60 px-3 py-1 text-xs text-muted">Looks like: {group[0].note}</div>}
                  {group.map((i) => <button key={i.id} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-raised/60" onClick={() => openItem(i)}><span className="truncate">{i.label}</span>{i.detail && <span className="shrink-0 text-xs text-muted">{i.detail}</span>}</button>)}
                  <div className="flex justify-end gap-2 border-t border-line/60 px-3 py-1.5"><button className="btn btn-ghost !py-1 text-xs" title="These are different songs: stop listing them" onClick={() => updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, notDuplicates: [...ignoredDupes(lib), dupeSignature(group.map((i) => i.id))] } }))}><X size={13} />Not duplicates</button><button className="btn btn-accent !py-1 text-xs" onClick={() => edit({ kind: 'merge-tracks', id: group.map((i) => i.id).join(',') })}><GitMerge size={13} />Merge these {group.length}</button></div>
                </div>); })}</div> :
              c.unmarkNoYoutube ? <div className="max-h-80 divide-y divide-line/60 overflow-y-auto">{c.items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-4 py-2 text-sm"><button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => edit({ kind: 'album', id: i.id })}>{i.label}{i.detail && <span className="text-xs text-muted"> · {i.detail}</span>}</button><button className="btn !py-1 text-xs" onClick={() => patch('albums', i.id, { noYoutube: false })}>Put back</button></div>))}</div> :
              c.albumLinks ? <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">{c.items.slice(0, 200).map((i) => <AlbumLinkRow key={i.id} item={i} />)}</div> :
              <div className="max-h-80 divide-y divide-line/60 overflow-y-auto">{c.items.slice(0, 200).map((i) => (
                <button key={`${i.kind}${i.id}`} disabled={!['track', 'album', 'artist', 'release'].includes(i.kind)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-raised/60 disabled:cursor-default disabled:hover:bg-transparent" onClick={() => openItem(i)}>
                  <span className="truncate">{i.label}</span>{i.detail && <span className="shrink-0 text-xs text-muted">{i.detail}</span>}</button>))}
                {c.items.length > 200 && <div className="px-4 py-2 text-xs text-muted">…and {c.items.length - 200} more</div>}</div>}
            </div>)}
        </section>))}
      {bulk && <BulkLinks kind={bulk} onClose={() => setBulk(null)} />}
    </div>
  );
}
