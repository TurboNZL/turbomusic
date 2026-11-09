import { describe, expect, it } from 'vitest';
import { findLocalServer, tokenFiles } from '../src/localServer.ts';

describe('local server detection', () => {
  it('knows the Linux service locations and honours the env file', () => {
    expect(tokenFiles('linux', '/home/a', '/x').map((c) => c.file)).toEqual(['/var/lib/turbomusic/token', '/home/a/turbomusic-data/token']);
    const c = tokenFiles('linux', '/home/a', '/x', 'TURBOMUSIC_DATA_DIR=/mnt/m\nTURBOMUSIC_PORT=50000\n');
    expect(c[0]).toEqual({ file: '/mnt/m/token', port: 50000 });
  });
  it('reads the Windows tray server settings', () => {
    const c = tokenFiles('win32', 'C:/u', 'C:/AppData', '', () => ({ dataDir: 'D:/lib', port: 47900 }));
    expect(c[0]).toEqual({ file: 'D:/lib/token', port: 47900 });
  });
  it('connects to the first server that answers, token or not', async () => {
    const cands = [{ file: '/a/token', port: 1 }, { file: '/b/token', port: 2 }];
    const probe = { health: async (u: string) => u.endsWith(':2'), read: (f: string) => (f === '/b/token' ? ' tok\n' : null) };
    expect(await findLocalServer(cands, probe)).toEqual({ url: 'http://127.0.0.1:2', token: 'tok', tokenFile: '/b/token' });
    expect(await findLocalServer(cands, { health: async () => true, read: () => null }, 1)).toMatchObject({ token: '' });
    expect(await findLocalServer(cands, { health: async () => false, read: () => null })).toBeNull();
  });
});
