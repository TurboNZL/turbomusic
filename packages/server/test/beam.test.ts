import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Beam, SINK, ffmpegArgs } from '../src/beam.ts';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter(); stderr = new EventEmitter(); killed: string[] = [];
  kill(sig: string) { this.killed.push(sig); return true; }
}
function rig() {
  const kids: { child: FakeChild; bin: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const beam = new Beam({ ffmpegDir: '/opt/ff', env: () => ({ XDG_RUNTIME_DIR: '/run/user/998' }),
    spawnImpl: ((bin: string, args: string[], o: { env?: NodeJS.ProcessEnv }) => { const child = new FakeChild(); kids.push({ child, bin, args, env: o.env }); return child; }) as never });
  return { beam, kids };
}

describe('Beam (Soloist\'s sound as a live stream)', () => {
  it('captures the virtual output as MP3 with ffmpeg, in the sound session of this account', () => {
    const { beam, kids } = rig();
    beam.listen(() => undefined, () => undefined);
    expect(kids).toHaveLength(1);
    expect(kids[0].bin).toBe('/opt/ff/ffmpeg'); expect(kids[0].env).toMatchObject({ XDG_RUNTIME_DIR: '/run/user/998' });
    expect(kids[0].args).toEqual(ffmpegArgs());
    expect(kids[0].args).toContain(`${SINK}.monitor`); expect(kids[0].args.slice(-3)).toEqual(['-f', 'mp3', 'pipe:1']);
  });
  it('runs ffmpeg once for any number of listeners, gives each the same bytes, and stops with the last one', () => {
    const { beam, kids } = rig();
    const a: Buffer[] = [], b: Buffer[] = [];
    const la = beam.listen((c) => a.push(c), () => undefined);
    const lb = beam.listen((c) => b.push(c), () => undefined);
    expect(kids).toHaveLength(1); expect(beam.status()).toMatchObject({ listeners: 2, running: true });
    kids[0].child.stdout.emit('data', Buffer.from([1, 2, 3]));
    expect(a[0]).toEqual(Buffer.from([1, 2, 3])); expect(b[0]).toEqual(Buffer.from([1, 2, 3])); expect(beam.status().bytes).toBe(3);
    la.stop(); expect(kids[0].child.killed).toEqual([]);
    lb.stop(); expect(kids[0].child.killed).toEqual(['SIGTERM']); expect(beam.status().running).toBe(false);
  });
  it('starts a fresh ffmpeg for a later listener', () => {
    const { beam, kids } = rig();
    beam.listen(() => undefined, () => undefined).stop();
    beam.listen(() => undefined, () => undefined);
    expect(kids).toHaveLength(2);
  });
  it('says what is wrong when ffmpeg cannot listen, and ends the streams', () => {
    const { beam, kids } = rig(); let ended = 0;
    beam.listen(() => undefined, () => ended++);
    kids[0].child.stderr.emit('data', Buffer.from('pulse: Connection refused\n'));
    kids[0].child.emit('close', 1);
    expect(ended).toBe(1);
    expect(beam.status()).toMatchObject({ running: false, listeners: 0 });
    expect(beam.status().error).toMatch(/could not listen to the virtual output/);
  });
  it('says when ffmpeg is not installed', () => {
    const { beam, kids } = rig();
    beam.listen(() => undefined, () => undefined);
    kids[0].child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }));
    expect(beam.status().error).toMatch(/ffmpeg is not installed/);
  });
});

describe('Beam jitter buffer', () => {
  it('holds sound back until the buffer is full, then sends it at the stream rate (a burst is not sent as a burst)', async () => {
    const kids: FakeChild[] = [];
    const beam = new Beam({ bufferSec: () => 0.5, spawnImpl: (() => { const c = new FakeChild(); kids.push(c); return c; }) as never });
    const got: number[] = [];
    beam.listen((c) => got.push(c.length), () => undefined);
    kids[0].stdout.emit('data', Buffer.alloc(4000)); // a quarter of a second: not enough to start
    await new Promise((r) => setTimeout(r, 120));
    expect(got).toEqual([]);
    expect(beam.status().buffered).toBeCloseTo(0.3, 1);
    kids[0].stdout.emit('data', Buffer.alloc(8000)); // now half a second is held: it starts leaving, but only as fast as the clock allows
    await new Promise((r) => setTimeout(r, 150));
    const sent = got.reduce((a, b) => a + b, 0);
    expect(sent).toBeGreaterThan(0); expect(sent).toBeLessThan(8000); // 150 ms at 16 kB/s is about 2400 bytes (chunks are sent whole)
  });
  it('with no buffer the sound goes straight through, as before', () => {
    const kids: FakeChild[] = [];
    const beam = new Beam({ spawnImpl: (() => { const c = new FakeChild(); kids.push(c); return c; }) as never });
    const got: Buffer[] = [];
    beam.listen((c) => got.push(c), () => undefined);
    kids[0].stdout.emit('data', Buffer.from([9]));
    expect(got).toHaveLength(1);
  });
  it('reads bigger pieces when a buffer is on', () => {
    expect(ffmpegArgs(undefined, 3)).toContain('8192'); expect(ffmpegArgs()).toContain('2048');
  });
});
