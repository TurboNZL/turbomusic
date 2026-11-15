import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

/**
 * "Beaming": Spotify Soloist can only play through the sound server of the machine it runs on. With beaming on, Soloist is pointed at a
 * virtual output (a PulseAudio/PipeWire null sink called `turbomusic_spotify`) instead of the speakers, and this class listens to that
 * output with ffmpeg, encodes it as a live MP3 stream and hands the bytes to every connected app (`GET /api/soloist/stream`). The apps play
 * the stream like internet radio, so Spotify tracks are heard on the phone (or in the browser) while the Pi stays silent.
 * ffmpeg only runs while somebody listens. The stream is live: it has a few seconds of delay and no pausing of its own (Spotify's
 * play/pause go through the Spotify API; a paused Soloist simply sends silence).
 */
export const SINK = 'turbomusic_spotify';

export function ffmpegArgs(source = `${SINK}.monitor`): string[] {
  // Latency: no input probing (it waits for data before starting), small sound-server fragments, no MP3 bit reservoir or Xing header (the
  // reservoir holds frames back), and a rate a phone on mobile data or a tunnel can keep up with (128 kbps is plenty for a stream of a stream).
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', 'nobuffer', '-flags', 'low_delay', '-probesize', '32', '-analyzeduration', '0',
    '-fragment_size', '2048', '-f', 'pulse', '-i', source,
    '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', '-reservoir', '0', '-write_xing', '0', '-flush_packets', '1', '-f', 'mp3', 'pipe:1'];
}

export interface BeamDeps {
  spawnImpl?: typeof spawn;
  ffmpegDir?: string;
  /** the environment ffmpeg is started with (must reach the sound server) */
  env?: () => NodeJS.ProcessEnv;
  /** test seam: replaces the ffmpeg command */
  command?: { bin: string; args: string[] };
}
export interface BeamStatus { listeners: number; running: boolean; error: string | null; bytes: number }

type Listener = { data: (chunk: Buffer) => void; end: () => void };

export class Beam {
  private d: BeamDeps;
  private listeners = new Set<Listener>();
  private child: ChildProcess | null = null;
  private error: string | null = null;
  private bytes = 0;
  constructor(deps: BeamDeps = {}) { this.d = deps; }

  /** Start listening to the stream. Returns a function that stops. ffmpeg starts with the first listener and stops with the last. */
  listen(data: (chunk: Buffer) => void, end: () => void): { stop: () => void } {
    const l: Listener = { data, end };
    this.listeners.add(l);
    if (!this.child) this.startChild();
    return { stop: () => { if (this.listeners.delete(l) && this.listeners.size === 0) this.stopChild(); } };
  }

  status(): BeamStatus { return { listeners: this.listeners.size, running: !!this.child, error: this.error, bytes: this.bytes }; }

  private startChild() {
    this.error = null;
    const bin = this.d.command?.bin ?? (this.d.ffmpegDir ? join(this.d.ffmpegDir, 'ffmpeg') : 'ffmpeg');
    const args = this.d.command?.args ?? ffmpegArgs();
    const child = (this.d.spawnImpl ?? spawn)(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: this.d.env?.() ?? process.env });
    this.child = child;
    let err = '';
    child.stdout?.on('data', (c: Buffer) => { this.bytes += c.length; for (const l of this.listeners) l.data(c); });
    child.stderr?.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-600); });
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (this.child === child) this.child = null;
      this.error = e.code === 'ENOENT' ? 'ffmpeg is not installed on this machine' : e.message;
      this.endAll();
    });
    child.on('close', (code) => {
      if (this.child !== child) return; // stopped on purpose
      this.child = null;
      const last = err.trim().split('\n').pop() ?? '';
      this.error = /pulse|connection|no such|refused|opening input|not permitted/i.test(last) ? `ffmpeg could not listen to the virtual output (${last}). Is the sound server running for this account? See Settings > Spotify > Soloist.` : `ffmpeg stopped (exit ${code}). ${last}`.trim();
      this.endAll();
    });
  }
  private endAll() { const ls = [...this.listeners]; this.listeners.clear(); for (const l of ls) l.end(); }
  private stopChild() { const c = this.child; this.child = null; if (c) c.kill('SIGTERM'); }
  /** server shutdown */
  close() { this.endAll(); this.stopChild(); }
}
