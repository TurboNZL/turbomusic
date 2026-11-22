import { Fragment, useState } from 'react';
import { Layers, CalendarCheck, CheckCircle2, ChevronDown, ClipboardPaste, Eraser, GitMerge, ImageDown, Search, Tags, UserRound, X } from 'lucide-react';
import { HealthHero } from '../components/HealthHero.tsx';
import { AudioQualityCard, MissingAudioCard } from '../components/AudioTools.tsx';
import { AlbumSuggestions } from '../components/AlbumSuggestions.tsx';
import { QuickFix } from '../components/HealthQuick.tsx';
import { HealthChips, HealthMeters, HealthTiles } from '../components/HealthViews.tsx';
import { CheckBody } from '../components/HealthBody.tsx';
import { useMenu } from '../components/Menu.tsx';
import { useTrackMenuItems } from '../components/TrackMenu.tsx';
import { useAlbumMenuItems, useArtistMenuItems } from '../components/entityMenus.tsx';
import { usePlayer } from '../lib/player.ts';
import { CatalogueCard } from '../components/CatalogueCard.tsx';
import { BulkLinks } from '../components/BulkLinks.tsx';
import type { LinkKind } from '../lib/bulkLinks.ts';
import { fetchCoverFromLinks } from '../lib/cover.ts';
import { thumbnailUrls, youtubeId } from '../lib/youtube.ts';
import { suggestKeeper } from '../lib/mergeTracks.ts';
import { computeHealth, dupeSignature, ignoredDupes, type HealthItem } from '../lib/health.ts';
import { updateProfile } from '../lib/profile.ts';
import { useLibraryLive } from '../lib/derive.ts';
import { useEditor } from '../lib/editor.ts';
import { useStore } from '../lib/store.ts';
import { cn } from '../lib/cn.ts';
import { withoutLegacyArtist, FEATURED_ROLE } from '../lib/defaults.ts';
import { matchArtist, splitFeaturing } from '../lib/autofill.ts';
import type { Credit } from '@turbomusic/core';

/** One album that is waiting for its YouTube link: paste it and the import-into-album screen opens already looked up. */
function AlbumLinkRow({ item, ctx }: { item: HealthItem; ctx?: (i: HealthItem) => ((e: React.MouseEvent) => void) | undefined }) {
  const edit = useEditor((s) => s.open);
  const [url, setUrl] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm" onContextMenu={ctx?.(item)}>
      <button className="min-w-0 flex-1 basis-48 truncate text-left hover:underline" onClick={() => edit({ kind: 'album', id: item.id })}>{item.label}{item.detail && <span className="text-xs text-muted"> · {item.detail}</span>}</button>
      <input className="input !w-72 max-w-full !py-1 text-xs" placeholder="Paste a YouTube Music album link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && edit({ kind: 'import-into-album', id: item.id, url: url.trim() })} />
      <button className="btn !py-1 text-xs" disabled={!url.trim()} onClick={() => edit({ kind: 'import-into-album', id: item.id, url: url.trim() })}>Import</button>
    </div>
  );
}

/** Most important first: what stops music playing, then what makes the library wrong, then what is merely incomplete or tidy-up. */
const PRIORITY = ['dead-links', 'no-audio', 'no-source', 'album-empty', 'fake-quality', 'low-quality', 'no-lead', 'duplicates', 'needs-source', 'album-no-cover', 'artist-no-image', 'release-no-date', 'single-no-date', 'album-no-genre', 'no-genre', 'no-youtube', 'no-youtube-album', 'no-spotify', 'no-genius', 'genre-similar', 'artist-unused', 'genre-unused', 'role-unused', 'note-category-unused'];
/** The headings the checks sit under, so a long list reads as four short ones. */
const GROUP: Record<string, string> = {
  'dead-links': 'Things that stop music playing', 'no-audio': 'Things that stop music playing', 'no-source': 'Things that stop music playing', 'album-empty': 'Things that stop music playing', 'fake-quality': 'Things that stop music playing', 'low-quality': 'Things that stop music playing',
  'no-lead': 'Missing or wrong information', duplicates: 'Missing or wrong information', 'needs-source': 'Missing or wrong information', 'release-no-date': 'Missing or wrong information', 'single-no-date': 'Missing or wrong information', 'album-no-genre': 'Missing or wrong information', 'no-genre': 'Missing or wrong information', 'album-no-cover': 'Missing or wrong information', 'artist-no-image': 'Missing or wrong information',
  'no-youtube': 'Links', 'no-youtube-album': 'Links', 'no-spotify': 'Links', 'no-genius': 'Links',
};
const groupOf = (id: string) => GROUP[id] ?? 'Tidying up';
const priority = (id: string) => { const i = PRIORITY.indexOf(id); return i < 0 ? 500 : i; };

export function HealthPage() {
  const lib = useLibraryLive(true);
  const edit = useEditor((s) => s.open);
  const remove = useStore((s) => s.remove);
  const [open, setOpen] = useState<string | null>(null);
  const patch = useStore((s) => s.patch);
  const put = useStore((s) => s.put);
  const configured = useStore((s) => !!s.settings.token);
  const [covers, setCovers] = useState<{ running: boolean; done: number; total: number; failed: number } | null>(null);
  const [bulk, setBulk] = useState<LinkKind | null>(null);
  const checks = computeHealth(lib);
  const menu = useMenu();
  const trackItems = useTrackMenuItems();
  const albumItems = useAlbumMenuItems();
  const artistItems = useArtistMenuItems();
  /** right-click on a problem opens the same menu as anywhere else (tracks, albums, artists; a release opens its album's) */
  const ctx = (i: HealthItem): ((e: React.MouseEvent) => void) | undefined => {
    if (i.kind === 'track') { const t = lib.trackById.get(i.id); return t ? menu.onContextMenu(trackItems(t, () => usePlayer.getState().play(t.id, [t.id], { type: 'search', id: 'Library health' })), t.title) : undefined; }
    const albumId = i.kind === 'album' || i.kind === 'album-source' ? i.id : i.kind === 'release' ? lib.releases.find((r) => r.id === i.id)?.albumId : undefined;
    const a = albumId ? lib.albumById.get(albumId) : undefined;
    if (a) return menu.onContextMenu(albumItems(a), a.title);
    if (i.kind === 'artist' && lib.artistById.has(i.id)) return menu.onContextMenu(artistItems(i.id), i.label);
    return undefined;
  };

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
  /** cut "(feat. X)" out of titles and keep X as a Featured artist credit */
  function moveFeaturedToCredits(items: HealthItem[]) {
    const made = new Map<string, string>();
    for (const i of items) {
      const d = useStore.getState().rows.tracks.get(i.id)?.data as { title: string; credits?: Credit[] } | undefined;
      if (!d) continue;
      const sp = splitFeaturing(d.title);
      if (!sp.featured.length) continue;
      const credits = [...(d.credits ?? [])];
      for (const n of sp.featured) {
        const k = n.toLowerCase();
        let id = made.get(k) ?? matchArtist(lib.artists, n)?.id;
        if (!id) id = put('artists', { name: n, image: null });
        made.set(k, id);
        if (!credits.some((c) => c.artistId === id)) credits.push({ artistId: id, role: [FEATURED_ROLE] });
      }
      patch('tracks', i.id, { title: sp.title, credits });
    }
  }
  const problems = checks.filter((c) => c.items.length);
  // what to fix first on top (most important first); checks with nothing to fix go last, folded but still open-able
  const ordered = [...checks].sort((a, b) => (a.items.length ? 0 : 1) - (b.items.length ? 0 : 1) || priority(a.id) - priority(b.id));
  const firstClear = ordered.findIndex((c) => !c.items.length);
  const openItem = (i: HealthItem) => (i.kind === 'track' || i.kind === 'album' || i.kind === 'artist' || i.kind === 'release') && edit({ kind: i.kind, id: i.id });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <HealthHero lib={lib} problems={problems.length} total={checks.length} />
      <CatalogueCard />
      <div className="grid gap-4 md:grid-cols-2"><MissingAudioCard /><AudioQualityCard /></div>
      {ordered.map((c, idx) => (
        <Fragment key={c.id}>
        {idx !== firstClear && c.items.length > 0 && (idx === 0 || groupOf(ordered[idx - 1].id) !== groupOf(c.id) || ordered[idx - 1].items.length === 0) && <h2 className="pt-2 text-sm font-semibold uppercase tracking-wider text-muted">{groupOf(c.id)}</h2>}
        {idx === firstClear && <h2 className="pt-2 text-sm font-semibold uppercase tracking-wider text-muted">Nothing to fix ({ordered.length - firstClear})</h2>}
        <section className="card overflow-hidden">
          <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            {c.items.length ? <span className="min-w-8 rounded-full bg-warn/20 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-warn">{c.items.length}</span> : <CheckCircle2 size={18} className="text-good" />}
            <span className="flex-1 text-sm font-medium">{c.title}</span>
            <ChevronDown size={16} className={cn('text-muted transition-transform', open === c.id && 'rotate-180')} />
          </button>
          {open === c.id && c.items.length === 0 && <div className="space-y-2 border-t border-line px-4 py-3"><p className="text-xs text-muted">{c.why}</p><p className="text-sm text-good">Nothing to fix here.</p>{c.id === 'needs-source' && <AlbumSuggestions />}</div>}
          {open === c.id && c.items.length > 0 && (
            <div className="border-t border-line">
              <p className="px-4 py-2 text-xs text-muted">{c.why}</p>
              {c.id === 'needs-source' && <div className="px-4 pb-3"><AlbumSuggestions /></div>}
              {c.id === 'album-no-cover' && <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
                <button className="btn" disabled={!configured || covers?.running} onClick={() => void fillCovers(c.items.map((i) => i.id))}><ImageDown size={15} />Try YouTube thumbnails</button>
                <span className="text-xs text-muted">{!configured ? 'Needs a server (Settings).' : covers ? `${covers.done}/${covers.total} done${covers.failed ? `, ${covers.failed} failed` : ''}${covers.running ? '…' : ''}` : 'Uses each album\'s first track link. Check the results; replace any that look wrong.'}</span></div>}
              {(c.bulk || c.matchLinks) && <div className="flex flex-wrap gap-2 px-4 pb-2">{c.matchLinks && <button className="btn btn-accent" onClick={() => edit({ kind: 'match-links', id: '' })}><Search size={15} />Find YouTube Music albums</button>}{c.bulk && <button className="btn" onClick={() => setBulk(c.bulk!)}><ClipboardPaste size={15} />Paste links by album</button>}</div>}
              {c.clearDead && <div className="px-4 pb-2"><button className="btn" onClick={() => confirm(`Forget the dead-link mark on ${c.items.length} tracks?`) && c.items.forEach((i) => patch('tracks', i.id, { youtubeDead: null }))}><Eraser size={15} />Forget these marks</button></div>}
              {(c.findImages || c.findGenres || c.mergeGenres) && <div className="flex flex-wrap gap-2 px-4 pb-2">
                {c.findImages && <button className="btn btn-accent" onClick={() => edit({ kind: 'find-artist-images', id: '' })}><UserRound size={15} />Find pictures online</button>}
                {c.findGenres && <button className="btn btn-accent" onClick={() => edit({ kind: 'find-genres', id: '' })}><Tags size={15} />Find genres online</button>}
                {c.mergeGenres && <button className="btn btn-accent" onClick={() => edit({ kind: 'merge-genres', id: '' })}><GitMerge size={15} />Merge tags…</button>}</div>}
              {c.autoDates && <div className="px-4 pb-2"><button className="btn btn-accent" onClick={() => edit({ kind: 'find-dates', id: '' })}><CalendarCheck size={15} />Find dates automatically</button></div>}
              {c.moveFeatured && <div className="px-4 pb-2"><button className="btn" onClick={() => confirm(`Move the featured artists of ${c.items.length} titles into the credits?`) && moveFeaturedToCredits(c.items)}>Move to credits ({c.items.length})</button></div>}
              {c.addLead && <div className="px-4 pb-2"><button className="btn" onClick={() => confirm(`${c.addLead!.label} (${c.items.length})?`) && addLeadCredits(c.items)}>{c.addLead.label}</button></div>}
              {c.fix && <div className="px-4 pb-2"><button className="btn text-bad" onClick={() => confirm(`${c.fix!.label} (${c.items.length})?`) && c.items.forEach((i) => remove(c.fix!.table, i.id))}>{c.fix.label}</button></div>}
              <CheckBody check={c} lib={lib}>{(items) => (<>
              {c.view === 'tiles' ? <HealthTiles items={items} lib={lib} onOpen={openItem} ctx={ctx} /> :
              c.view === 'chips' ? <HealthChips check={{ ...c, items }} ctx={ctx} onOpen={openItem} onRemove={(i) => c.fix && remove(c.fix.table, i.id)} /> :
              c.view === 'meter' ? <HealthMeters items={items} lib={lib} onOpen={openItem} ctx={ctx} /> :
              c.quick ? <QuickFix check={{ ...c, items }} ctx={ctx} /> :
              c.mergeGroups ? <div className="space-y-2 px-4 pb-3">{[...new Set(items.map((i) => i.group))].map((g) => { const group = items.filter((i) => i.group === g); return (
                <div key={g} className="rounded-theme border border-line">
                  {group[0]?.note && <div className="border-b border-line/60 px-3 py-1 text-xs text-muted">Looks like: {group[0].note}</div>}
                  {group.map((i) => <button key={i.id} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-raised/60" onClick={() => openItem(i)} onContextMenu={ctx(i)}><span className="truncate">{i.label}</span>{i.detail && <span className="shrink-0 text-xs text-muted">{i.detail}</span>}</button>)}
                  <div className="flex justify-end gap-2 border-t border-line/60 px-3 py-1.5"><button className="btn btn-ghost !py-1 text-xs" title="These are different songs: stop listing them" onClick={() => updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, notDuplicates: [...ignoredDupes(lib), dupeSignature(group.map((i) => i.id))] } }))}><X size={13} />Not duplicates</button><button className="btn btn-ghost !py-1 text-xs" title="Different audio (a remaster, a live take, the music-video audio): keep every track with its own file and album place, but share one set of votes and one rating" onClick={() => { const keep = suggestKeeper(group.flatMap((i) => lib.trackById.get(i.id) ?? [])); if (confirm(`Treat these as recordings of one song? “${keep.title}” stays the main version; the others keep their audio and albums but share its votes and rating.`)) group.filter((i) => i.id !== keep.id).forEach((i) => patch('tracks', i.id, { versionOf: keep.id })); }}><Layers size={13} />Different recordings of one song</button><button className="btn btn-accent !py-1 text-xs" title="The very same audio: one track, listed on every album it is on" onClick={() => edit({ kind: 'merge-tracks', id: group.map((i) => i.id).join(',') })}><GitMerge size={13} />Merge these {group.length}</button></div>
                </div>); })}</div> :
              c.unmarkNoYoutube ? <div className="divide-y divide-line/60">{items.map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-4 py-2 text-sm" onContextMenu={ctx(i)}><button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => edit({ kind: 'album', id: i.id })}>{i.label}{i.detail && <span className="text-xs text-muted"> · {i.detail}</span>}</button><button className="btn !py-1 text-xs" onClick={() => patch('albums', i.id, { noYoutube: false })}>Put back</button></div>))}</div> :
              c.albumLinks ? <div className="divide-y divide-line/60">{items.map((i) => <AlbumLinkRow key={i.id} item={i} ctx={ctx} />)}</div> :
              <div className="divide-y divide-line/60">{items.map((i) => (
                <button key={`${i.kind}${i.id}`} onContextMenu={ctx(i)} disabled={!['track', 'album', 'artist', 'release'].includes(i.kind)} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-raised/60 disabled:cursor-default disabled:hover:bg-transparent" onClick={() => openItem(i)}>
                  <span className="truncate">{i.label}</span>{i.detail && <span className="shrink-0 text-xs text-muted">{i.detail}</span>}</button>))}</div>}
              </>)}</CheckBody>
            </div>)}
        </section>
        </Fragment>))}
      {menu.element}
      {bulk && <BulkLinks kind={bulk} onClose={() => setBulk(null)} />}
    </div>
  );
}
