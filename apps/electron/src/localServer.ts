import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Putting the two halves together. The "TurboMusic App" edition has no library of its own; the "TurboMusic Server" edition (Linux service or the
 * Windows tray app) is only a library. When both are installed on one computer the app finds the server by itself and connects to it, so the
 * pair behaves like the full program, and removing either half just puts the other back to how it was (nothing is copied or merged).
 */
export interface LocalServer {
  url: string;
  /** '' when the server is there but its token file cannot be read by this user (a Linux service keeps it private) */
  token: string;
  /** where the token file is, for the one-time administrator prompt */
  tokenFile: string;
}

export const DEFAULT_PORT = 47813;

/** Where a server edition on this computer would keep its token, most likely first. `envFile` is the text of /etc/turbomusic/server.env (may be ''). */
export function tokenFiles(platform: NodeJS.Platform, home: string, appData: string, envFile = '', readJson: (p: string) => unknown = () => null): { file: string; port: number }[] {
  const out: { file: string; port: number }[] = [];
  const envVal = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*(.+?)\\s*$`, 'm').exec(envFile)?.[1]?.replace(/^["']|["']$/g, '');
  if (platform === 'win32' || platform === 'darwin') {
    // the tray server keeps its choices (data folder, port) in its own settings folder
    const dir = join(appData, 'TurboMusic Server');
    const cfg = readJson(join(dir, 'server-edition.json')) as { dataDir?: string; port?: number } | null;
    out.push({ file: join(cfg?.dataDir || join(dir, 'library'), 'token'), port: Number(cfg?.port) || DEFAULT_PORT });
  } else {
    out.push({ file: join(envVal('TURBOMUSIC_DATA_DIR') || '/var/lib/turbomusic', 'token'), port: Number(envVal('TURBOMUSIC_PORT')) || DEFAULT_PORT });
    out.push({ file: join(home, 'turbomusic-data', 'token'), port: DEFAULT_PORT });
  }
  return out;
}

export interface Probe { health(url: string): Promise<boolean>; read(file: string): string | null }

/** The first server edition that answers on this computer, with its token when this user may read it. */
export async function findLocalServer(candidates: { file: string; port: number }[], probe: Probe, skipPort?: number): Promise<LocalServer | null> {
  for (const c of candidates) {
    if (c.port === skipPort) continue;
    const url = `http://127.0.0.1:${c.port}`;
    if (!(await probe.health(url))) continue;
    const token = (probe.read(c.file) ?? '').trim();
    return { url, token, tokenFile: c.file };
  }
  return null;
}

export const realProbe: Probe = {
  health: async (url) => { try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } },
  read: (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } },
};
export const readText = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
export const readJsonFile = (p: string): unknown => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
