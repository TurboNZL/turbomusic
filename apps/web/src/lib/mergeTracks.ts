import type { PlaybackRule, RecordTable, TrackData } from '@turbomusic/core';
import type { Library, Track } from './library.ts';
import { allSpotifyUrls, linkFields } from './spotifyLinks.ts';

/**
 * Merging duplicate tracks (the same song entered twice, such as a single and the album version): one track survives, everything
 * the others had is folded into it and everything that pointed at them (tracklists, playlists, eras, votes, plays, notes, playback
 * rules) is pointed at the survivor instead. Pure: it returns what to write, so it can be shown before it is done and tested.
 */
export interface MergePlan {
  keepId: string; removeIds: string[];
  keep: Partial<TrackData>;
  /** records in other tables to patch */
  patches: { table: RecordTable; id: string; patch: object }[];
  /** records to delete (votes that would compare a track with itself) */
  deletes: { table: RecordTable; id: string }[];
  /** what happens, in plain words */
  summary: string[];
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const first = <T,>(...xs: (T | null | undefined | '')[]): T | null => (xs.find((x) => x != null && x !== '') as T | undefined) ?? null;

/** Which of the tracks to keep by default: the one with the most votes, then audio, then an album, then the oldest-listed. */
export function suggestKeeper(tracks: Track[]): Track {
  return [...tracks].sort((a, b) => b.comparisons - a.comparisons || Number(!!b.file) - Number(!!a.file) || Number(!!b.albumId) - Number(!!a.albumId) || (b.memories ?? 0) - (a.memories ?? 0))[0];
}

/** `raw` returns a track as stored (a derived track's `cover` may be its album's, which must not become the track's own). */
export function planMerge(lib: Library, keepId: string, dropIds: string[], raw: (id: string) => Partial<TrackData> | undefined = () => undefined): MergePlan | null {
  const keep = lib.trackById.get(keepId);
  const drops = uniq(dropIds).filter((id) => id !== keepId).flatMap((id) => lib.trackById.get(id) ?? []);
  if (!keep || !drops.length) return null;
  const dropSet = new Set(drops.map((d) => d.id));
  const remap = (id: string) => (dropSet.has(id) ? keepId : id);
  const summary: string[] = [];

  // --- the surviving track itself: only stored fields, never derived ones
  const all = [keep, ...drops];
  const links = linkFields(all.flatMap((t) => allSpotifyUrls(t)));
  const withFile = all.find((t) => t.file);
  const fields: Partial<TrackData> = {
    ...links,
    youtubeMusicUrl: first(...all.map((t) => t.youtubeMusicUrl)),
    geniusUrl: first(...all.map((t) => t.geniusUrl)),
    initialRating: first(keep.initialRating, ...drops.map((t) => t.initialRating)),
    memories: all.reduce((n, t) => n + (t.memories ?? 0), 0),
    cover: first(...all.map((t) => (raw(t.id) ?? { cover: null }).cover)),
    genres: uniq(all.flatMap((t) => (t.syncWithAlbumCredits && t.albumId ? [] : t.genres ?? []))),
  };
  if (!keep.file && withFile) Object.assign(fields, { file: withFile.file, bitrate: withFile.bitrate, audioCheck: withFile.audioCheck ?? null });
  const albums = [...(keep.albums ?? [])];
  for (const d of drops) for (const l of d.albums ?? []) if (!albums.some((a) => a.albumId === l.albumId)) albums.push({ ...l });
  fields.albums = albums;
  if (links.spotifyUrls.length) summary.push(`${links.spotifyUrls.length + 1} Spotify links kept (the first one plays)`);
  if (!keep.file && withFile) summary.push('takes the audio of the other track');
  if (albums.length > (keep.albums ?? []).length) summary.push('joins the albums of the other track');
  const votes = lib.votes.filter((v) => dropSet.has(v.trackAId) || dropSet.has(v.trackBId) || (v.winnerId != null && dropSet.has(v.winnerId)));
  const comps = drops.reduce((n, d) => n + d.comparisons, 0);
  if (comps) summary.push(`${comps} comparisons are added to this track's votes`);
  if (fields.memories !== (keep.memories ?? 0)) summary.push(`memories add up to ${fields.memories}`);

  // --- everything that pointed at a removed track
  const patches: MergePlan['patches'] = [];
  const deletes: MergePlan['deletes'] = [];
  const mapList = (ids: string[]) => uniq(ids.map(remap));
  const changed = (a: string[], b: string[]) => a.length !== b.length || a.some((x, i) => x !== b[i]);

  for (const r of lib.releases) { const next = mapList(r.trackIds ?? []); if (changed(r.trackIds ?? [], next)) patches.push({ table: 'releases', id: r.id, patch: { trackIds: next } }); }
  for (const a of lib.albums) {
    const order = (a as { trackOrder?: string[] }).trackOrder;
    if (order) { const next = mapList(order); if (changed(order, next)) patches.push({ table: 'albums', id: a.id, patch: { trackOrder: next } }); }
  }
  for (const p of lib.playlists) {
    const next = mapList(p.trackIds ?? []);
    const notes = p.trackNotes ?? {};
    const hasNote = Object.keys(notes).some((k) => dropSet.has(k));
    if (changed(p.trackIds ?? [], next) || hasNote) {
      const patch: { trackIds: string[]; trackNotes?: Record<string, string> } = { trackIds: next };
      if (hasNote) {
        const merged: Record<string, string> = {};
        for (const [k, v] of Object.entries(notes).sort(([a], [b]) => Number(dropSet.has(a)) - Number(dropSet.has(b)))) merged[remap(k)] = merged[remap(k)] ? `${merged[remap(k)]}\n${v}` : v;
        patch.trackNotes = merged;
      }
      patches.push({ table: 'playlists', id: p.id, patch });
    }
  }
  for (const e of lib.eras) { const next = mapList(e.trackIds); if (changed(e.trackIds, next)) patches.push({ table: 'eras', id: e.id, patch: { trackIds: next } }); }
  for (const v of votes) {
    const a = remap(v.trackAId), b = v.trackBId ? remap(v.trackBId) : v.trackBId;
    if (v.trackBId && a === b) { deletes.push({ table: 'votes', id: v.id }); continue; } // the two tracks of this vote are now one
    patches.push({ table: 'votes', id: v.id, patch: { trackAId: a, trackBId: b, winnerId: v.winnerId ? remap(v.winnerId) : v.winnerId } });
  }
  const dropped = deletes.length;
  if (dropped) summary.push(`${dropped} vote${dropped === 1 ? '' : 's'} between the two are dropped (a track cannot beat itself)`);
  const logs = lib.logs.filter((l) => dropSet.has(l.trackId));
  for (const l of logs) patches.push({ table: 'playbackLogs', id: l.id, patch: { trackId: keepId } });
  if (logs.length) summary.push(`${logs.length} plays move to this track`);
  for (const m of (lib.memoryLogs ?? []).filter((m) => dropSet.has(m.trackId))) patches.push({ table: 'memoryLogs', id: m.id, patch: { trackId: keepId } });
  for (const g of lib.groups) {
    if (!g.members.some((m) => m.entityType === 'track' && dropSet.has(m.entityId))) continue;
    const seen = new Set<string>();
    const members = g.members.map((m) => (m.entityType === 'track' ? { ...m, entityId: remap(m.entityId) } : m)).filter((m) => { const k = `${m.entityType}:${m.entityId}`; return !seen.has(k) && !!seen.add(k); });
    patches.push({ table: 'groups', id: g.id, patch: { members } });
  }
  if (lib.profile?.playbackRules?.some((r) => dropSet.has(r.trackAId) || dropSet.has(r.trackBId))) {
    const seen = new Set<string>();
    const rules: PlaybackRule[] = lib.profile.playbackRules.map((r) => ({ ...r, trackAId: remap(r.trackAId), trackBId: remap(r.trackBId) }))
      .filter((r) => r.trackAId !== r.trackBId && !seen.has(`${r.trackAId}>${r.trackBId}`) && !!seen.add(`${r.trackAId}>${r.trackBId}`));
    patches.push({ table: 'profiles', id: lib.profile.id, patch: { playbackRules: rules } });
  }
  const lists = patches.filter((p) => ['releases', 'albums', 'playlists', 'eras'].includes(p.table)).length;
  if (lists) summary.push(`${lists} tracklist${lists === 1 ? '' : 's'} (albums, releases, playlists, eras) now point here`);
  return { keepId, removeIds: drops.map((d) => d.id), keep: fields, patches, deletes, summary };
}
