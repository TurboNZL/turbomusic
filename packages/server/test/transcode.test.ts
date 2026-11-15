import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filePath } from '../src/files.ts';
import { cleanKbps, transcodedPath } from '../src/transcode.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('transcode', () => {
  it('rounds a requested bit rate to a supported one and ignores nonsense', () => {
    expect(cleanKbps('128')).toBe(128);
    expect(cleanKbps('130')).toBe(128);
    expect(cleanKbps('1000')).toBe(320);
    expect(cleanKbps('0')).toBeNull();
    expect(cleanKbps('abc')).toBeNull();
    expect(cleanKbps(undefined)).toBeNull();
  });
  it('returns null for a file that is not there', async () => {
    expect(await transcodedPath({ dataDir: mkdtempSync(join(tmpdir(), 'tm-')) }, 'a'.repeat(64), 128)).toBeNull();
  });
  it.skipIf(!hasFfmpeg)('makes one smaller copy and reuses it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-'));
    const src = join(dir, 'src.mp3');
    expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-b:a', '320k', src]).status).toBe(0);
    const hash = 'b'.repeat(64);
    mkdirSync(join(dir, 'files', 'bb'), { recursive: true });
    copyFileSync(src, filePath(dir, hash));
    const a = await transcodedPath({ dataDir: dir }, hash, 96);
    expect(a).toBeTruthy();
    expect(statSync(a!).size).toBeLessThan(statSync(src).size / 2);
    expect(await transcodedPath({ dataDir: dir }, hash, 96)).toBe(a);
  });
});
