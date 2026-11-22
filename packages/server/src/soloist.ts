import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { arch as osArch, hostname as osHostname, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import { Beam, SINK, type BeamDeps, type BeamStatus } from './beam.ts';

/**
 * Spotify Soloist as a module of this server: Spotify's own headless Spotify Connect client for Linux. Installed from Spotify's own download
 * server onto the machine running TurboMusic (it is not redistributed with TurboMusic: Spotify asks that nobody does), it shows up in
 * Spotify's device list under a name you choose, and TurboMusic plays Spotify tracks on it like on any other Spotify device.
 *
 * Facts this follows (Spotify's Soloist documentation, Oct 2026): builds come from
 * https://soloist-builds.spotifycdn.com/soloist_release_<arm64|arm32|x86_64>.tar.gz and contain the `soloist` executable; it needs
 * PipeWire or PulseAudio on the machine, a Premium account's API key (`--api-key`) and a device name (`--device-name`); a build stops working
 * 90 days after it was built and then exits with code 10, so a newer one is downloaded and it is started again. The API key is a secret:
 * it is kept in a 0600 file in the data folder and is never sent back to a client.
 */
export const ARCHIVE_HOST = 'https://soloist-builds.spotifycdn.com';
export const EXPIRED = 10;

/** Node's `process.arch` as the name Spotify gives the archive, or null when Soloist has no build for it. */
export function archiveName(arch: string = osArch()): string | null {
  const a = arch === 'arm64' ? 'arm64' : arch === 'arm' ? 'arm32' : arch === 'x64' ? 'x86_64' : null;
  return a ? `soloist_release_${a}.tar.gz` : null;
}

/** The machine the server (and so Soloist) runs on, so the settings can say where the sound is made. */
export interface SoloistHost { name: string; model: string | null; isPi: boolean }

function readPiModel(): string | null {
  for (const p of ['/proc/device-tree/model', '/sys/firmware/devicetree/base/model']) { try { const m = readFileSync(p, 'utf8').replace(/\0/g, '').trim(); if (m) return m; } catch { /* not a device-tree machine */ } }
  return null;
}

export interface SoloistConfig { deviceName: string; apiKey: string; autoStart: boolean; outputDevice: string; /** send Soloist's sound to a virtual output that the apps listen to (beam.ts) instead of the speakers */ beam: boolean; /** seconds of sound the stream holds back so a busy moment on the server is not heard (0 = none) */ bufferSec: number }
/** Whether Soloist can reach a sound server (PipeWire or PulseAudio) from the account this server runs as, and what to do if not. */
export interface AudioCheck { ok: boolean; server: 'pipewire' | 'pulseaudio' | null; runtimeDir: string | null; hint: string | null }
export interface SoloistStatus {
  supported: boolean; reason?: string;
  installed: boolean; version: string | null;
  configured: boolean; deviceName: string; hasKey: boolean; autoStart: boolean; outputDevice: string;
  /** where Soloist runs: the machine this server is on */
  host: SoloistHost;
  audio: AudioCheck;
  /** beaming Soloist's sound to the apps (beam.ts) */
  beam: { enabled: boolean; bufferSec: number; sink: 'ready' | 'missing' | 'error' | 'unchecked'; sinkMessage: string | null; streamPath: string } & BeamStatus;
  running: boolean; state: 'stopped' | 'starting' | 'running' | 'expired' | 'installing' | 'error';
  message: string | null; log: string[];
  downloadsUrl: string;
}

type Spawn = typeof spawn;
export interface SoloistDeps {
  fetchImpl?: typeof fetch; spawnImpl?: Spawn; platform?: string; arch?: string;
  /** unpack a .tar.gz into a folder (test seam; the default runs the system `tar`) */
  untar?: (archive: string, into: string) => Promise<void>;
  /** wait before restarting after a crash */
  restartDelayMs?: number;
  /** run `soloist --version` */
  version?: (bin: string) => Promise<string | null>;
  /** test seams for the audio check */
  uid?: number; env?: NodeJS.ProcessEnv; exists?: (path: string) => boolean; desktop?: boolean;
  /** where ffmpeg and pactl live when they are not on PATH, and test seams for the beam */
  /** test seams for where it runs: the device-tree model (a Raspberry Pi says so) and the host name */
  model?: string | null; hostname?: string;
  ffmpegDir?: string; beamDeps?: BeamDeps; pactl?: (args: string[]) => Promise<string>;
}

const run = (cmd: string, args: string[], spawnImpl: Spawn = spawn, env?: NodeJS.ProcessEnv): Promise<string> => new Promise((resolve, reject) => {
  let out = '';
  const child = spawnImpl(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
  const timer = setTimeout(() => { child.kill(); reject(new Error(`${cmd} took too long`)); }, 60_000);
  child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
  child.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `${cmd} is not installed on this machine` : e.message)); });
  child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(out.trim().split('\n').pop() || `${cmd} exited ${code}`)); });
});

/**
 * Where to run `pactl` from: the tools folder only when it really holds one (a bundled ffmpeg folder normally does not: pactl comes from the
 * system package pulseaudio-utils), otherwise whatever is on PATH. Looking only in the tools folder made an installed pactl look missing.
 */
export function pactlCommand(toolsDir?: string): string {
  if (toolsDir) { const own = join(toolsDir, 'pactl'); if (existsSync(own)) return own; }
  return 'pactl';
}

export class Soloist {
  private readonly dir: string;
  private readonly d: SoloistDeps;
  private child: ChildProcess | null = null;
  private wanted = false;
  private state: SoloistStatus['state'] = 'stopped';
  private message: string | null = null;
  private log: string[] = [];
  private crashes = 0;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** the live stream of Soloist's sound (see beam.ts) */
  readonly beam: Beam;
  private sink: { state: 'ready' | 'missing' | 'error' | 'unchecked'; message: string | null } = { state: 'unchecked', message: null };

  constructor(dataDir: string, deps: SoloistDeps = {}) {
    this.dir = join(dataDir, 'soloist'); this.d = deps;
    this.beam = new Beam({ ffmpegDir: deps.ffmpegDir, env: () => this.soloistEnv(), bufferSec: () => this.config().bufferSec, ...deps.beamDeps });
  }

  private get platform() { return this.d.platform ?? osPlatform(); }
  private get bin() { return join(this.dir, 'soloist'); }
  private get cfgPath() { return join(this.dir, 'config.json'); }

  config(): SoloistConfig {
    try { const c = JSON.parse(readFileSync(this.cfgPath, 'utf8')) as Partial<SoloistConfig>; return { deviceName: c.deviceName ?? 'TurboMusic', apiKey: c.apiKey ?? '', autoStart: c.autoStart ?? true, outputDevice: c.outputDevice ?? '', beam: c.beam ?? false, bufferSec: Math.max(0, Math.min(30, Number(c.bufferSec) || 0)) }; }
    catch { return { deviceName: 'TurboMusic', apiKey: '', autoStart: true, outputDevice: '', beam: false, bufferSec: 0 }; }
  }
  /** Saves the device name and, when one is given, the key. An empty key leaves the stored one alone. */
  configure(o: { deviceName?: string; apiKey?: string; autoStart?: boolean; outputDevice?: string; beam?: boolean; bufferSec?: number }) {
    const cur = this.config();
    const name = (o.deviceName ?? cur.deviceName).trim().slice(0, 60);
    if (!name) throw new Error('Give the device a name.');
    mkdirSync(this.dir, { recursive: true });
    const next: SoloistConfig = { deviceName: name, apiKey: o.apiKey?.trim() ? o.apiKey.trim() : cur.apiKey, autoStart: o.autoStart ?? cur.autoStart, outputDevice: (o.outputDevice ?? cur.outputDevice).trim().slice(0, 200), beam: o.beam ?? cur.beam, bufferSec: o.bufferSec === undefined ? cur.bufferSec : Math.max(0, Math.min(30, Math.round(o.bufferSec * 10) / 10)) };
    writeFileSync(this.cfgPath, JSON.stringify(next), { mode: 0o600 });
    try { chmodSync(this.cfgPath, 0o600); } catch { /* a filesystem without modes */ }
  }

  /**
   * Soloist plays only through PipeWire or PulseAudio, and finds them through the user's runtime folder (/run/user/<uid>). A server started
   * by systemd as its own account has no such session in its environment, so Soloist connected to Spotify but had nowhere to send the
   * sound. This finds the sockets of a session that does exist for this account (kept alive by `loginctl enable-linger`) and hands them over.
   */
  private audioSockets() {
    const exists = this.d.exists ?? existsSync, env = this.d.env ?? process.env;
    const uid = this.d.uid ?? (typeof process.getuid === 'function' ? process.getuid() : -1);
    const dirs = [env.XDG_RUNTIME_DIR, uid >= 0 ? `/run/user/${uid}` : undefined].filter((x): x is string => !!x);
    for (const dir of [...new Set(dirs)]) {
      if (exists(join(dir, 'pipewire-0'))) return { dir, server: 'pipewire' as const, pulse: exists(join(dir, 'pulse', 'native')) ? join(dir, 'pulse', 'native') : null };
      if (exists(join(dir, 'pulse', 'native'))) return { dir, server: 'pulseaudio' as const, pulse: join(dir, 'pulse', 'native') };
    }
    return null;
  }
  audio(): AudioCheck {
    const found = this.audioSockets();
    if (found) return { ok: true, server: found.server, runtimeDir: found.dir, hint: null };
    // inside the desktop app the sound server is the desktop's own (PipeWire or PulseAudio, standard on Linux desktops)
    if (this.d.desktop ?? !!process.versions.electron) return { ok: false, server: null, runtimeDir: null, hint: 'No PipeWire or PulseAudio sound server was found on this computer, and Soloist can only play through one of them. Most Linux desktops have one already: check that sound works in other programs, install pipewire-pulse (or pulseaudio) if it does not, then press Start again.' };
    return { ok: false, server: null, runtimeDir: null, hint: 'No sound server is running for the account that runs this server, so Soloist connects to Spotify but cannot play anything. On the Pi run: sudo /home/turbomusic/turbomusic/scripts/setup-pi-audio.sh (it installs PipeWire and keeps it running for the turbomusic account), then press Start again.' };
  }
  /** The environment Soloist is started with: the normal one plus the audio session this account can reach. */
  private soloistEnv(): NodeJS.ProcessEnv {
    const base = { ...(this.d.env ?? process.env) };
    const found = this.audioSockets();
    if (found) { base.XDG_RUNTIME_DIR = found.dir; if (found.pulse && !base.PULSE_SERVER) base.PULSE_SERVER = `unix:${found.pulse}`; }
    return base;
  }

  host(): SoloistHost {
    const model = this.d.model !== undefined ? this.d.model : readPiModel();
    return { name: this.d.hostname ?? osHostname(), model, isPi: !!model && /raspberry pi/i.test(model) };
  }

  /** Soloist is Spotify's headless player for a Pi that has speakers or a DAC: it is offered on a Raspberry Pi only (TURBOMUSIC_SOLOIST=1 allows another Linux machine). */
  support(): { ok: boolean; reason?: string } {
    if (this.platform !== 'linux') return { ok: false, reason: 'Soloist only runs on Linux, on your Raspberry Pi.' };
    if (!archiveName(this.d.arch ?? osArch())) return { ok: false, reason: `Spotify has no Soloist build for this processor (${this.d.arch ?? osArch()}).` };
    const h = this.host();
    if (!h.isPi && (this.d.env ?? process.env).TURBOMUSIC_SOLOIST !== '1') {
      return { ok: false, reason: this.d.desktop ?? !!process.versions.electron
        ? 'Soloist runs on your Raspberry Pi server only, not in this app. Connect this app to your Pi (Settings > Library & server) and set Soloist up there.'
        : `Soloist runs on your Raspberry Pi only, and this server (${h.name}) is not one. Open TurboMusic on the Pi's server to set Soloist up there.` };
    }
    return { ok: true };
  }

  async status(): Promise<SoloistStatus> {
    const sup = this.support(), c = this.config(), installed = existsSync(this.bin);
    return {
      supported: sup.ok, reason: sup.reason, installed, version: installed && sup.ok ? await (this.d.version ?? this.readVersion.bind(this))(this.bin).catch(() => null) : null,
      configured: !!c.apiKey, deviceName: c.deviceName, hasKey: !!c.apiKey, autoStart: c.autoStart, outputDevice: c.outputDevice, host: this.host(), audio: this.audio(),
      beam: { enabled: c.beam, bufferSec: c.bufferSec, sink: this.sink.state, sinkMessage: this.sink.message, streamPath: '/api/soloist/stream', ...this.beam.status() },
      running: !!this.child, state: this.state, message: this.message, log: this.log.slice(-12), downloadsUrl: 'https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates',
    };
  }
  private async readVersion(bin: string) { return (await run(bin, ['--version'], this.d.spawnImpl)).trim().split('\n')[0] || null; }

  /** Download the newest build for this processor from Spotify's own server and put it in place. Replaces an older build. */
  async install(): Promise<void> {
    const sup = this.support();
    if (!sup.ok) throw new Error(sup.reason);
    if (this.busy) throw new Error('Already installing.');
    this.busy = true; const was = this.state; this.state = 'installing'; this.message = 'Downloading from Spotify…';
    const tmp = join(this.dir, `dl-${Date.now()}`);
    try {
      mkdirSync(tmp, { recursive: true });
      const res = await (this.d.fetchImpl ?? fetch)(`${ARCHIVE_HOST}/${archiveName(this.d.arch ?? osArch())}`, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`Spotify's download server answered ${res.status}`);
      const archive = join(tmp, 'soloist.tar.gz');
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
      this.message = 'Unpacking…';
      await (this.d.untar ?? ((a, into) => run('tar', ['-xzf', a, '-C', into]).then(() => undefined)))(archive, tmp);
      const found = existsSync(join(tmp, 'soloist')) ? join(tmp, 'soloist') : null;
      if (!found) throw new Error('The download did not contain a soloist program.');
      chmodSync(found, 0o755);
      const running = !!this.child;
      if (running) await this.stop();
      renameSync(found, this.bin);
      this.message = 'Installed.'; this.state = 'stopped';
      if (running || (was === 'expired' && this.wanted)) this.start();
    } catch (e) { this.state = 'error'; this.message = (e as Error).message; throw e; }
    finally { rmSync(tmp, { recursive: true, force: true }); this.busy = false; }
  }

  uninstall() { void this.stop(); rmSync(this.dir, { recursive: true, force: true }); this.state = 'stopped'; this.message = null; this.log = []; }

  /** Start the daemon (and keep it running: crashes restart it, an expired build is replaced). */
  start(): void {
    const sup = this.support();
    if (!sup.ok) throw new Error(sup.reason);
    if (!existsSync(this.bin)) throw new Error('Soloist is not installed yet.');
    const c = this.config();
    if (!c.apiKey) throw new Error('Paste your Soloist API key first.');
    if (this.child || this.launching) return;
    this.wanted = true; this.state = 'starting'; this.message = null;
    mkdirSync(join(this.dir, 'cache'), { recursive: true });
    if (!c.beam) { this.spawnChild(c); return; }
    // beaming: the virtual output has to exist before Soloist starts, because Soloist is pointed at it
    this.launching = true;
    void this.ensureSink().then(() => { this.launching = false; if (this.wanted && !this.child) this.spawnChild(this.config()); }, () => { this.launching = false; });
  }

  private launching = false;
  private async pactl(args: string[]): Promise<string> { return this.d.pactl ? this.d.pactl(args) : run(pactlCommand(this.d.ffmpegDir), args, this.d.spawnImpl, this.soloistEnv()); }
  /** Make sure the null sink Soloist plays into exists (created once per sound-server session). Beaming only works when it does. */
  async ensureSink(): Promise<void> {
    try {
      const sinks = await this.pactl(['list', 'short', 'sinks']);
      if (!sinks.split('\n').some((l) => l.split('\t')[1] === SINK)) await this.pactl(['load-module', 'module-null-sink', `sink_name=${SINK}`, 'sink_properties=device.description=TurboMusic-Spotify']);
      this.sink = { state: 'ready', message: null };
    } catch (e) {
      const m = (e as Error).message;
      this.sink = { state: 'error', message: /not installed/.test(m) ? 'pactl is missing: install pulseaudio-utils (sudo apt install pulseaudio-utils).' : `Could not create the virtual output: ${m}` };
      this.state = 'error'; this.message = this.sink.message; this.wanted = false;
      throw e;
    }
  }

  private spawnChild(c: SoloistConfig): void {
    const out = c.beam ? SINK : c.outputDevice;
    const args = ['--device-name', c.deviceName, '--api-key', c.apiKey, '--cache-dir', join(this.dir, 'cache'), ...(out ? ['--pipewire-device', out] : [])];
    const env = this.soloistEnv(); if (c.beam) env.PULSE_SINK = SINK;
    const child = (this.d.spawnImpl ?? spawn)(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    if (!this.audio().ok) { this.log.push('Warning: no PipeWire or PulseAudio session found for this account; Soloist will have no sound output.'); }
    this.child = child;
    const keep = (d: Buffer) => {
      for (const line of d.toString().split('\n').map((l) => l.trim()).filter(Boolean)) this.log.push(line.replaceAll(c.apiKey, '•••').slice(0, 300));
      this.log = this.log.slice(-40);
      if (this.state === 'starting') this.state = 'running';
    };
    child.stdout?.on('data', keep); child.stderr?.on('data', keep);
    setTimeout(() => { if (this.child === child && this.state === 'starting') this.state = 'running'; this.crashes = this.child === child ? 0 : this.crashes; }, 8000).unref?.();
    child.on('error', (e: NodeJS.ErrnoException) => { this.child = null; this.state = 'error'; this.message = e.code === 'ENOENT' ? 'The soloist program could not be started.' : e.message; });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.wanted) { this.state = 'stopped'; return; }
      if (code === EXPIRED) {
        // the build ran out (they last 90 days): fetch the current one and start again
        this.state = 'expired'; this.message = 'This build of Soloist expired; downloading a newer one…';
        void this.install().catch((e: Error) => { this.state = 'error'; this.message = `Could not update Soloist: ${e.message}`; });
        return;
      }
      this.crashes++;
      this.message = `Soloist stopped (exit ${code}). ${/audio|pulse|pipewire/i.test(this.log.join(' ')) || !this.audio().ok ? (this.audio().hint ?? 'It needs PipeWire or PulseAudio on this machine.') : this.log.at(-1) ?? ''}`.trim();
      if (this.crashes > 5) { this.state = 'error'; this.wanted = false; this.message += ' Gave up after 5 tries.'; return; }
      this.state = 'starting';
      this.timer = setTimeout(() => { if (this.wanted && !this.child) { try { this.start(); } catch (e) { this.state = 'error'; this.message = (e as Error).message; } } }, this.d.restartDelayMs ?? 5000);
    });
  }

  stop(): Promise<void> {
    this.wanted = false; clearTimeout(this.timer);
    const c = this.child;
    if (!c) { this.state = 'stopped'; return Promise.resolve(); }
    return new Promise((resolve) => { c.once('close', () => resolve()); c.kill('SIGTERM'); setTimeout(() => { if (this.child === c) c.kill('SIGKILL'); resolve(); }, 4000).unref?.(); });
  }

  /** On server start: bring it up again when it was set up and left on. */
  autoStart(): void { try { if (this.support().ok && existsSync(this.bin) && this.config().apiKey && this.config().autoStart) this.start(); } catch { /* shown in status */ } }
}
