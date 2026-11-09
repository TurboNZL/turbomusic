import { create } from 'zustand';
import { newId, RECORD_TABLES, wins, type RecordTable, type SyncRecord } from '@turbomusic/core';
import { Api } from './api.ts';
import { flushUploads, type CacheEntry } from './files.ts';
import { getMeta, localDb, setMeta } from './idb.ts';
import { loadSettings, saveSettings, type DeviceSettings } from './settings.ts';
import { applyAppearance, watchSystemTheme } from './appearance.ts';
import { withoutLegacyArtist } from './defaults.ts';
import { droppedCover, withCoverKept } from './covers.ts';
import { planNoteMigration } from './noteMigration.ts';

export type SyncState = 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncInfo { state: SyncState; lastSync: number | null; pending: number; error: string | null }

type Rows = Record<RecordTable, Map<string, SyncRecord>>;
const emptyRows = (): Rows => Object.fromEntries(RECORD_TABLES.map((t) => [t, new Map()])) as unknown as Rows;

interface State {
  ready: boolean;
  /** bumped on every data change; selectors key their caches on it */
  rev: number;
  /** bumped when only the play history changed: the derived library is NOT rebuilt for it (a skip would otherwise cost a full rebuild) */
  logsRev: number;
  rows: Rows;
  settings: DeviceSettings;
  sync: SyncInfo;
  init(): Promise<void>;
  updateSettings(patch: Partial<DeviceSettings>): void;
  /** create/replace a record (full `data`); returns its id */
  put(table: RecordTable, data: object, id?: string, opts?: { forget?: string[] }): string;
  patch(table: RecordTable, id: string, partial: object): void;
  remove(table: RecordTable, id: string): void;
  /** restore from a backup: merge keeps whichever side is newer, replace makes this device match the backup (what it lacks becomes deleted) */
  importRecords(records: SyncRecord[], mode: 'merge' | 'replace'): Promise<{ applied: number; removed: number }>;
  syncNow(): Promise<void>;
  /** bumped when a local file is added so image hooks re-resolve */
  filesRev: number;
  touchFiles(): void;
  /** audio kept on this device, by file hash */
  audioCache: Record<string, CacheEntry>;
}

let syncing: Promise<void> | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

export const useStore = create<State>((set, get) => {
  const bump = () => set((s) => ({ rev: s.rev + 1 }));
  const touch = (table: string) => set((s) => (table === 'playbackLogs' ? { logsRev: s.logsRev + 1 } : { rev: s.rev + 1 }));
  const setSync = (p: Partial<SyncInfo>) => set((s) => ({ sync: { ...s.sync, ...p } }));
  const api = () => new Api(get().settings);
  const configured = () => !!get().settings.token;

  /** appends a release's or album's replaced cover to the album's pool (album records are changed in place; releases patch their album) */
  function keepCover(table: RecordTable, data: object, id: string, forget: string[]) {
    const rows = get().rows;
    const prev = rows[table].get(id);
    if (!prev || prev.deleted) return;
    const gone = droppedCover((prev.data as { cover?: string | null }).cover, (data as { cover?: string | null }).cover);
    if (!gone || forget.includes(gone)) return;
    if (table === 'albums') {
      const a = data as { covers?: string[] };
      if (!(a.covers ?? []).includes(gone)) a.covers = [...(a.covers ?? []), gone];
    } else if (table === 'releases') {
      const albumId = (data as { albumId?: string }).albumId ?? '';
      const album = rows.albums.get(albumId);
      if (!album || album.deleted) return;
      const mine = [...rows.releases.values()].filter((r) => !r.deleted && (r.data as { albumId?: string }).albumId === albumId && r.id !== id).map((r) => r.data as { cover: string | null });
      const nextRelease = { cover: (data as { cover: string | null }).cover };
      const covers = withCoverKept(album.data as { covers?: string[]; cover?: string | null }, [...mine, nextRelease], gone);
      if (covers !== ((album.data as { covers?: string[] }).covers ?? [])) get().put('albums', { ...album.data, covers }, albumId);
    }
  }

  async function write(rec: SyncRecord, queue: boolean) {
    const db = await localDb();
    const tx = db.transaction(['records', 'outbox'], 'readwrite');
    tx.objectStore('records').put(rec);
    if (queue) tx.objectStore('outbox').put({ table: rec.table, id: rec.id });
    await tx.done;
  }

  function schedulePush() {
    clearTimeout(debounce);
    debounce = setTimeout(() => void get().syncNow(), 1500);
  }

  async function runSync() {
    if (!configured()) { setSync({ state: 'unconfigured' }); return; }
    setSync({ state: 'syncing', error: null });
    const a = api();
    try {
      const db = await localDb();
      await flushUploads(a); // images first, so records never point at a hash the server lacks for long
      // 1. push everything queued
      for (;;) {
        const keys = (await db.getAll("outbox")).slice(0, 2000);
        if (!keys.length) break;
        const recs = (await Promise.all(keys.map((k) => db.get('records', [k.table, k.id])))).filter((r): r is SyncRecord => !!r);
        await a.push(recs);
        const tx = db.transaction('outbox', 'readwrite');
        for (const k of keys) {
          // keep it queued if it was edited while the push was in flight
          const cur = get().rows[k.table].get(k.id);
          const sent = recs.find((r) => r.table === k.table && r.id === k.id);
          if (!cur || !sent || cur.updatedAt === sent.updatedAt) tx.store.delete([k.table, k.id]);
        }
        await tx.done;
      }
      // 2. pull what changed elsewhere
      let cursor = await getMeta<number>('cursor', 0);
      for (;;) {
        const page = await a.pull(cursor, 1000);
        if (page.records.length) await applyRemote(page.records);
        cursor = page.cursor;
        await setMeta('cursor', cursor);
        if (!page.more) break;
      }
      migrateLegacyArtists();
      migrateNotes();
      const pending = (await db.count('outbox'));
      setSync({ state: 'idle', lastSync: Date.now(), pending });
      await setMeta('lastSync', Date.now());
    } catch (e) {
      const offline = e instanceof TypeError; // fetch() network failure
      setSync({ state: offline ? 'offline' : 'error', error: offline ? 'Server unreachable' : (e as Error).message });
    }
  }

  /**
   * The old single-artist field is gone: every track and album that still has `artistId` gets it as a Lead
   * artist credit and loses the field. Runs after a successful pull (so it never works on half-synced data) and
   * is a no-op once nothing has the field any more, which also makes it safe on several devices.
   */
  function migrateLegacyArtists() {
    for (const table of ['tracks', 'albums'] as const) {
      for (const [id, rec] of [...get().rows[table]]) {
        if (rec.deleted) continue;
        const next = withoutLegacyArtist(rec.data as { artistId?: string; credits?: never[] });
        if (next) get().put(table, next, id);
      }
    }
  }

  /** Notes and relational bios became one thing (see noteMigration.ts). */
  function migrateNotes() {
    const live = (t: RecordTable) => [...get().rows[t].values()].filter((r) => !r.deleted).map((r) => ({ id: r.id, data: r.data as never }));
    const plan = planNoteMigration(live('notes'), live('groups'), live('noteCategories'));
    for (const c of plan.categories) get().put('noteCategories', c.data, c.id);
    for (const g of plan.groups) get().put('groups', g.data, g.id);
    for (const id of plan.removeNotes) get().remove('notes', id);
  }

  async function applyRemote(records: SyncRecord[]) {
    const db = await localDb();
    const rows = get().rows;
    const tx = db.transaction(['records', 'outbox'], 'readwrite');
    let structural = false, logs = false;
    for (const r of records) {
      const { seq: _seq, ...rec } = r as SyncRecord & { seq?: number };
      const local = rows[rec.table]?.get(rec.id);
      if (!rows[rec.table] || !wins(rec, local)) continue;
      rows[rec.table].set(rec.id, rec);
      if (rec.table === 'playbackLogs') logs = true; else structural = true;
      tx.objectStore('records').put(rec);
      tx.objectStore('outbox').delete([rec.table, rec.id]); // remote won; nothing left to push
    }
    await tx.done;
    // a pull that changed nothing (our own push coming back) must not rebuild the library
    if (structural) bump();
    if (logs) touch('playbackLogs');
  }

  const stamp = (table: RecordTable, id: string, data: object, deleted: boolean): SyncRecord => ({
    table, id, updatedAt: Date.now(), deviceId: get().settings.deviceId, deleted, data: data as Record<string, unknown>,
  });

  return {
    ready: false, rev: 0, logsRev: 0, filesRev: 0, audioCache: {}, rows: emptyRows(),
    touchFiles() { set((s) => ({ filesRev: s.filesRev + 1 })); },
    settings: loadSettings(),
    sync: { state: 'unconfigured', lastSync: null, pending: 0, error: null },

    async init() {
      if (get().ready) return;
      const s = get().settings;
      applyAppearance(s);
      watchSystemTheme(() => get().settings);
      const db = await localDb();
      const rows = emptyRows();
      for (const r of await db.getAll('records')) rows[r.table]?.set(r.id, r);
      set({ rows, audioCache: await getMeta('audioCache', {}), ready: true, rev: 1, sync: { ...get().sync, lastSync: await getMeta('lastSync', null), pending: await db.count('outbox'), state: configured() ? 'idle' : 'unconfigured' } });
      if (!configured()) { migrateLegacyArtists(); migrateNotes(); }
      void get().syncNow();
      clearInterval(timer);
      timer = setInterval(() => void get().syncNow(), 30_000);
      window.addEventListener('online', () => void get().syncNow());
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      if (('serverUrl' in patch || 'token' in patch) && !('serverAuto' in patch)) settings.serverAuto = false; // the person chose: stop managing it
      saveSettings(settings);
      applyAppearance(settings);
      set({ settings });
      if ('token' in patch || 'serverUrl' in patch) void get().syncNow();
    },

    put(table, data, id = newId(), opts) {
      // an image that stops being used stays in its album's pool until it is deleted on purpose (`opts.forget`)
      keepCover(table, data, id, opts?.forget ?? []);
      const rec = stamp(table, id, data, false);
      get().rows[table].set(id, rec);
      touch(table);
      void write(rec, true).then(() => setSync({ pending: get().sync.pending + 1 }));
      schedulePush();
      return id;
    },

    patch(table, id, partial) {
      const cur = get().rows[table].get(id);
      if (!cur || cur.deleted) return;
      get().put(table, { ...cur.data, ...partial }, id);
    },

    remove(table, id) {
      const cur = get().rows[table].get(id);
      if (!cur) return;
      if (table === 'releases') keepCover(table, { ...(cur.data as object), cover: null }, id, []);
      const rec = stamp(table, id, cur.data, true);
      get().rows[table].set(id, rec);
      touch(table);
      void write(rec, true);
      schedulePush();
    },

    async importRecords(records, mode) {
      const rows = get().rows;
      const now = Date.now();
      const me = get().settings.deviceId;
      const db = await localDb();
      const tx = db.transaction(['records', 'outbox'], 'readwrite');
      const keep = (rec: SyncRecord) => { rows[rec.table].set(rec.id, rec); tx.objectStore('records').put(rec); tx.objectStore('outbox').put({ table: rec.table, id: rec.id }); };
      let applied = 0, removed = 0;
      if (mode === 'replace') {
        const incoming = new Set(records.map((r) => `${r.table}\u0000${r.id}`));
        for (const [table, map] of Object.entries(rows) as [RecordTable, Map<string, SyncRecord>][]) {
          for (const rec of [...map.values()]) {
            if (rec.deleted || incoming.has(`${table}\u0000${rec.id}`)) continue;
            keep({ ...rec, updatedAt: now, deviceId: me, deleted: true, data: {} });
            removed++;
          }
        }
      }
      for (const r of records) {
        if (!rows[r.table]) continue; // a table this version does not know
        const rec = mode === 'replace' ? { ...r, updatedAt: now, deviceId: me } : r;
        if (!wins(rec, rows[r.table].get(r.id))) continue;
        keep(rec);
        applied++;
      }
      await tx.done;
      bump();
      setSync({ pending: await db.count('outbox') });
      schedulePush();
      return { applied, removed };
    },

    syncNow() {
      // never run two syncs at once; a request during a run schedules one more after it
      if (syncing) return syncing.then(() => runSync());
      syncing = runSync().finally(() => { syncing = null; });
      return syncing;
    },
  };
});

export const api = () => new Api(useStore.getState().settings);
