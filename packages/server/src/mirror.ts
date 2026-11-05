import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Store } from './db.ts';
import { syncMirror, type MirrorMode, type MirrorResult } from './libraryExport.ts';

export interface MirrorSettings { enabled: boolean; mode: MirrorMode; dir: string | null }
export interface MirrorStatus extends MirrorSettings { defaultDir: string; effectiveDir: string; last: (MirrorResult & { at: number }) | null; error: string | null; running: boolean }

export class MirrorError extends Error { readonly status = 400; }

/**
 * The browsable copy of the library (`Artist/Album/NN Title.ext` as links to the real files). Off until switched on in Settings; once on it
 * follows the library: a change pushed to the server schedules a refresh a few seconds later, so a burst of edits is one run.
 */
export class Mirror {
  private file: string;
  private timer: NodeJS.Timeout | undefined;
  private last: MirrorStatus['last'] = null;
  private error: string | null = null;
  private running = false;
  private dataDir: string;
  private store: Store;
  private delayMs: number;
  constructor(dataDir: string, store: Store, delayMs = 8000) { this.dataDir = dataDir; this.store = store; this.delayMs = delayMs; this.file = join(dataDir, 'mirror.json'); }

  settings(): MirrorSettings {
    try { const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<MirrorSettings>; return { enabled: !!j.enabled, mode: j.mode === 'hardlink' || j.mode === 'copy' ? j.mode : 'symlink', dir: typeof j.dir === 'string' && j.dir ? j.dir : null }; }
    catch { return { enabled: false, mode: 'symlink', dir: null }; }
  }
  private defaultDir = () => join(this.dataDir, 'library');
  status(): MirrorStatus {
    const s = this.settings();
    return { ...s, defaultDir: this.defaultDir(), effectiveDir: s.dir ?? this.defaultDir(), last: this.last, error: this.error, running: this.running };
  }

  /** Change the settings. A folder of your own must be an absolute path and empty (or one this mirror already made), so nothing of yours is overwritten. */
  configure(change: Partial<MirrorSettings>): MirrorStatus {
    const cur = this.settings();
    const next: MirrorSettings = { enabled: change.enabled ?? cur.enabled, mode: change.mode ?? cur.mode, dir: change.dir === undefined ? cur.dir : (change.dir?.trim() || null) };
    if (!['symlink', 'hardlink', 'copy'].includes(next.mode)) throw new MirrorError('Unknown mode');
    if (next.dir) {
      if (!isAbsolute(next.dir)) throw new MirrorError('Give the full path of the folder');
      const dir = resolve(next.dir), data = resolve(this.dataDir);
      if (dir === data || dir.startsWith(`${data}/files`) || dir === resolve('/')) throw new MirrorError('Choose another folder: that one holds the library itself');
      if (existsSync(dir) && readdirSync(dir).length && !existsSync(join(dir, '.turbomusic-mirror.json'))) throw new MirrorError('That folder is not empty. Choose an empty folder, so nothing of yours is touched.');
      next.dir = dir;
    }
    writeFileSync(this.file, JSON.stringify(next));
    return this.status();
  }

  /** Run now (also used by the button). Returns what changed. */
  run(): MirrorResult {
    const s = this.settings();
    this.running = true;
    try {
      const dir = s.dir ?? this.defaultDir();
      mkdirSync(dir, { recursive: true });
      const r = syncMirror(this.store, this.dataDir, dir, s.mode);
      this.last = { ...r, at: Date.now() }; this.error = null;
      return r;
    } catch (e) { this.error = (e as Error).message; throw e; }
    finally { this.running = false; }
  }

  /** The library changed: refresh soon, once for a burst of changes. */
  touch() {
    if (!this.settings().enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { try { this.run(); } catch { /* shown in status */ } }, this.delayMs);
    this.timer.unref?.();
  }
}
