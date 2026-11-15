import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { filePath } from './files.ts';

/** Bit rates a device may ask for (kbps). Anything else is rounded to the nearest one. */
export const KBPS_CHOICES = [64, 96, 128, 160, 192, 256, 320] as const;

export function cleanKbps(raw: string | undefined | null): number | null {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return null;
  return KBPS_CHOICES.reduce((best, k) => (Math.abs(k - n) < Math.abs(best - n) ? k : best));
}

const pending = new Map<string, Promise<string | null>>();

/**
 * A smaller copy of a stored audio file (MP3 at a constant bit rate), made once with ffmpeg and kept in `<data>/cache/transcodes`,
 * for devices that save songs offline and would rather spend less space. Null when ffmpeg is missing or fails: the caller then
 * sends the original, so asking for a smaller file can never break a download.
 */
export function transcodedPath(o: { dataDir: string; ffmpegDir?: string }, hash: string, kbps: number): Promise<string | null> {
  const dir = join(o.dataDir, 'cache', 'transcodes');
  const out = join(dir, `${hash}-${kbps}.mp3`);
  if (existsSync(out)) return Promise.resolve(out);
  const key = `${hash}-${kbps}`;
  const running = pending.get(key);
  if (running) return running;
  const src = filePath(o.dataDir, hash);
  if (!existsSync(src)) return Promise.resolve(null);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${key}.${process.pid}.part.mp3`);
  const bin = o.ffmpegDir ? join(o.ffmpegDir, 'ffmpeg') : 'ffmpeg';
  const p = new Promise<string | null>((resolve) => {
    const child = spawn(bin, ['-v', 'error', '-y', '-i', src, '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, tmp], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 && existsSync(tmp) && statSync(tmp).size > 0) { renameSync(tmp, out); resolve(out); }
      else { rmSync(tmp, { force: true }); resolve(null); }
    });
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
