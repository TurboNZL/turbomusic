import { useEffect, useState } from 'react';
import type { Api } from './api.ts';
import { getMeta, localDb, setMeta } from './idb.ts';
import { audioMime } from './defaults.ts';
import { coverCrop } from './image.ts';
import { pickEvictions, type CacheEntry } from './cachePolicy.ts';
import { sha256Sync } from './sha256.ts';
import { api, useStore } from './store.ts';
import { blobUrlViaHeaders, freshBlobUrlViaHeaders } from './accessMedia.ts';
import { cachedImageUrl } from './imageCache.ts';
import { isAndroidApp } from './native.ts';

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return sha256Sync(new Uint8Array(data)); // insecure origin (plain http on the LAN)
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Covers and artist pictures are kept at 540 px on the long side: sharp on every grid and the player, a third of the bytes of 800 px. */
export const COVER_PX = 540;

/** Downscale to at most `max` px on the long side and re-encode as JPEG: covers do not need to be 4000 px. */
export async function prepareImage(file: Blob, max = COVER_PX, trimBars = false): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  let src = { x: 0, y: 0, w: bmp.width, h: bmp.height };
  if (trimBars) { // e.g. a YouTube thumbnail: drop the black bars, keep the centre square
    const probe = new OffscreenCanvas(bmp.width, bmp.height);
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(bmp, 0, 0);
    src = coverCrop(pctx.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, bmp.height);
  }
  const scale = Math.min(1, max / Math.max(src.w, src.h));
  const canvas = new OffscreenCanvas(Math.round(src.w * scale), Math.round(src.h * scale));
  canvas.getContext('2d')!.drawImage(bmp, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
}

/**
 * The upload queue is read-modify-written from several places (saving a file, a sync finishing), so changes
 * are serialised; otherwise a sync that ends after a new file was queued would overwrite the queue and lose it.
 */
let queueLock: Promise<unknown> = Promise.resolve();
const changePending = (change: (cur: string[]) => string[]): Promise<void> => {
  const run = queueLock.then(async () => { await setMeta('pendingUploads', change(await getMeta<string[]>('pendingUploads', []))); });
  queueLock = run.catch(() => undefined);
  return run;
};
const queueUpload = (hash: string) => changePending((cur) => (cur.includes(hash) ? cur : [...cur, hash]));

/**
 * Store an image on this device under its content hash and queue it for upload. The hash is what entities
 * reference, so the record can sync immediately; the bytes follow whenever the server is reachable.
 */
export async function saveImage(file: Blob, opts: { trimBars?: boolean } = {}): Promise<string> {
  const blob = await prepareImage(file, COVER_PX, opts.trimBars);
  const hash = await sha256Hex(await blob.arrayBuffer());
  const db = await localDb();
  await db.put('blobs', blob, hash);
  await queueUpload(hash);
  useStore.getState().touchFiles();
  void useStore.getState().syncNow();
  return hash;
}

/** Length of an audio file in seconds, or null when the browser cannot read it. */
export function audioDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (v: number | null) => { clearTimeout(timer); a.removeAttribute('src'); URL.revokeObjectURL(url); resolve(v); };
    const timer = setTimeout(() => done(null), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

/**
 * Take an audio file from this device: keep it under its content hash and queue the upload, exactly like
 * an image. The bitrate is the average (size / length), which is what the library shows for old tracks too.
 */
export async function saveAudio(file: File): Promise<{ hash: string; bitrate: string | null; seconds: number | null }> {
  const blob = new Blob([file], { type: audioMime(file.name, file.type) });
  const hash = await sha256Hex(await blob.arrayBuffer());
  const db = await localDb();
  await db.put('blobs', blob, hash);
  await queueUpload(hash);
  const seconds = await audioDuration(blob);
  useStore.getState().touchFiles();
  void useStore.getState().syncNow();
  return { hash, seconds, bitrate: seconds ? `${Math.round((blob.size * 8) / seconds / 1000)} kbps` : null };
}

/** Upload everything queued; called at the start of each sync. Failures stay queued. */
export async function flushUploads(a: Api): Promise<void> {
  const pending = await getMeta<string[]>('pendingUploads', []);
  if (!pending.length) return;
  const db = await localDb();
  const sent = new Set<string>();
  for (const hash of pending) {
    const blob = await db.get('blobs', hash);
    if (!blob) { sent.add(hash); continue; } // nothing left to send
    try {
      await a.putFile(hash, blob);
      sent.add(hash);
      // an uploaded audio file now lives on the server; keep a local copy only if the user chose "keep offline"
      if (blob.type.startsWith('audio/') && !useStore.getState().audioCache[hash]) await db.delete('blobs', hash);
    } catch { /* stays queued */ }
  }
  // drop only what was sent: files queued while this ran must survive
  await changePending((cur) => cur.filter((h) => !sent.has(h)));
}

/** Where to read an image from outside React (the media session): this device's copy as an object URL (`local`, revoke it), else the server's link. */
export async function imageSource(hash: string): Promise<{ url: string; local: boolean }> {
  const blob = await (await localDb()).get('blobs', hash);
  if (blob) return { url: URL.createObjectURL(blob), local: true };
  if (api().needsHeaderFetch) { try { return { url: await blobUrlViaHeaders(hash), local: false }; } catch { /* fall back to the plain link */ } }
  if (isAndroidApp()) { const u = await cachedImageUrl(hash); if (u) return { url: u, local: false }; }
  return { url: api().fileUrl(hash), local: false };
}

/** A displayable URL for a file hash: this device's copy if it has one, else the server's. */
export function useFileUrl(hash: string | null | undefined): string | null {
  const configured = useStore((s) => !!s.settings.token);
  const filesRev = useStore((s) => s.filesRev);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null, live = true;
    setUrl(null);
    if (!hash) return;
    void localDb().then((db) => db.get('blobs', hash)).then((blob) => {
      if (!live) return;
      if (blob) setUrl((revoke = URL.createObjectURL(blob)));
      else if (configured && api().needsHeaderFetch) void blobUrlViaHeaders(hash).then((u) => { if (live) setUrl(u); }, () => { if (live) setUrl(api().fileUrl(hash)); });
      else if (configured && isAndroidApp()) void cachedImageUrl(hash).then((u) => { if (live) setUrl(u ?? api().fileUrl(hash)); });
      else if (configured) setUrl(api().fileUrl(hash));
    });
    return () => { live = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [hash, configured, filesRev]);
  return url;
}

/* ---------- offline audio ---------- */

export type { CacheEntry };
export class CacheLimitError extends Error { constructor() { super('Storage limit reached'); } }

export const cacheBytes = (c: Record<string, CacheEntry>) => Object.values(c).reduce((n, e) => n + e.size, 0);

/** Download one audio file to this device. Throws CacheLimitError rather than exceed the user's limit. */
export async function downloadAudio(hash: string, protect: ReadonlySet<string> = new Set()): Promise<void> {
  const st = useStore.getState();
  if (st.audioCache[hash]) return;
  const kbps = st.settings.offlineKbps > 0 ? st.settings.offlineKbps : undefined;
  const res = await api().fetchLink(api().fileUrl(hash, kbps));
  if (!res.ok) throw new Error(`Server said ${res.status}`);
  const blob = await res.blob();
  const limit = st.settings.storageLimitOn ? st.settings.storageLimitMb * 1024 * 1024 : Infinity;
  const drop = pickEvictions(useStore.getState().audioCache, blob.size, limit, new Set([...protect, hash]));
  if (!drop || (drop.length && !st.settings.evictOldest)) throw new CacheLimitError();
  if (drop.length) await removeAudio(drop);
  const db = await localDb();
  await db.put('blobs', blob, hash);
  const next = { ...useStore.getState().audioCache, [hash]: { size: blob.size, at: Date.now() } };
  await setMeta('audioCache', next);
  useStore.setState({ audioCache: next });
}

export async function removeAudio(hashes: string[]): Promise<void> {
  const db = await localDb();
  const next = { ...useStore.getState().audioCache };
  for (const h of hashes) { if (next[h]) { await db.delete('blobs', h); delete next[h]; } }
  await setMeta('audioCache', next);
  useStore.setState({ audioCache: next });
}

/** This device's own copy of an audio file (kept offline, or chosen here and not uploaded yet) as an object URL; null if there is none. Never uses the network. */
export async function localAudio(hash: string): Promise<string | null> {
  const entry = useStore.getState().audioCache[hash];
  const db = await localDb();
  if (entry) {
    const next = { ...useStore.getState().audioCache, [hash]: { ...entry, at: Date.now() } }; // recency for eviction
    useStore.setState({ audioCache: next });
    void setMeta('audioCache', next);
    const blob = await db.get('blobs', hash);
    if (blob) return URL.createObjectURL(blob);
  }
  if ((await getMeta<string[]>('pendingUploads', [])).includes(hash)) {
    const blob = await db.get('blobs', hash);
    if (blob) return URL.createObjectURL(blob);
  }
  return null;
}

/** The address the Android app's own player streams `hash` from (it adds the token; the app caches what it plays). */
export const streamUrl = (hash: string) => api().fileUrl(hash);

/**
 * The next track, fetched whole in advance (one at a time) so starting it needs no network round trip. It is only ever USED when it
 * has fully arrived: a track that is still downloading when the user presses Next is dropped and streamed instead, never waited for
 * (waiting is what made Next feel slow on a slow link), and dropping it frees the connection for the stream.
 */
let prefetched: { hash: string; blob: Blob | null; abort: AbortController } | null = null;

/** Start downloading `hash` for the next track unless this device already has it or it is already being fetched. */
export function prefetchAudio(hash: string): void {
  if (prefetched?.hash === hash || useStore.getState().audioCache[hash]) return;
  prefetched?.abort.abort();
  const abort = new AbortController();
  const entry: { hash: string; blob: Blob | null; abort: AbortController } = { hash, blob: null, abort };
  prefetched = entry;
  void (async () => {
    try {
      const res = await api().fetchLink(api().fileUrl(hash), { signal: abort.signal });
      if (res.ok) entry.blob = await res.blob();
    } catch { /* aborted or offline: the track is streamed instead */ }
  })();
}

/** Stop a prefetch that is still running (the player calls this when the user jumps somewhere else). */
export function cancelPrefetch(): void { prefetched?.abort.abort(); prefetched = null; }

/** URL to play `hash` from: the local copy when kept offline, then a FINISHED prefetch, otherwise streamed from the server. Caller revokes blob: URLs. */
export async function audioSource(hash: string): Promise<{ url: string; local: boolean }> {
  // "always stream" still plays a copy that has not reached the server yet (it exists nowhere else)
  const streamOnly = useStore.getState().settings.preferLocalCopy === false && !(await getMeta<string[]>('pendingUploads', [])).includes(hash);
  const own = streamOnly ? null : await localAudio(hash);
  if (own) return { url: own, local: true };
  if (prefetched?.hash === hash) {
    const p = prefetched; prefetched = null;
    if (p.blob) return { url: URL.createObjectURL(p.blob), local: true };
    p.abort.abort(); // not finished: stream instead and give the stream the whole connection
  }
  if (api().needsHeaderFetch) { try { return { url: await freshBlobUrlViaHeaders(hash), local: true }; } catch { /* fall back to the plain link */ } }
  return { url: api().fileUrl(hash), local: false };
}

export interface KeepProgress { running: boolean; done: number; total: number; message: string | null }

/** Copy a set of tracks' audio to this device, in order, stopping cleanly at the storage limit. */
export async function keepOffline(hashes: string[], set: (p: KeepProgress) => void): Promise<void> {
  const todo = hashes.filter((h) => !useStore.getState().audioCache[h]);
  const batch = new Set(hashes); // a batch never evicts its own files
  set({ running: true, done: 0, total: todo.length, message: null });
  let done = 0;
  for (const h of todo) {
    try { await downloadAudio(h, batch); } catch (e) {
      set({ running: false, done, total: todo.length, message: e instanceof CacheLimitError ? 'Stopped: storage limit reached. Raise it or turn the Storage limiter off in Settings.' : 'Stopped: could not reach the server.' });
      return;
    }
    set({ running: true, done: ++done, total: todo.length, message: null });
  }
  set({ running: false, done, total: todo.length, message: null });
}
