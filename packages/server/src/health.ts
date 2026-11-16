import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readSync, realpathSync, statSync, statfsSync, unlinkSync, writeSync } from 'node:fs';
import { cpus, freemem, hostname, loadavg, platform, arch, totalmem, uptime } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * A cheap look at how the machine running the server is doing, for Settings. Everything here is a file read or a tiny syscall
 * (a few kilobytes at most), so asking every few seconds costs a Raspberry Pi nothing and writes next to nothing.
 */
export interface DiskInfo { label: string; path: string; freeBytes: number; totalBytes: number; device: number; /** this disk also holds the operating system (an SD card on a Pi) */ system: boolean }
export interface Throttle { raw: number; underVoltage: boolean; frequencyCapped: boolean; throttled: boolean; softTempLimit: boolean; underVoltageEver: boolean; throttledEver: boolean }
export interface HealthSnapshot {
  at: number; host: string; platform: string; arch: string; node: string;
  uptimeS: number; processUptimeS: number;
  cpu: { cores: number; load1: number; load5: number; load15: number };
  memory: { totalBytes: number; availableBytes: number; rssBytes: number };
  swap: { totalBytes: number; usedBytes: number } | null;
  tempC: number | null;
  throttle: Throttle | null;
  disks: DiskInfo[];
  /** one small synced write and read in the library's temp folder: how fast the disk answers right now */
  probe: { writeMs: number; readMs: number } | null;
  db: { bytes: number; walBytes: number };
}
export interface Warning { level: 'warn' | 'bad'; id: string; message: string }

/** `vcgencmd get_throttled` prints `throttled=0x50005`: low bits are now, bits 16+ are "since boot". */
export function parseThrottled(out: string): Throttle | null {
  const m = /0x([0-9a-f]+)/i.exec(out);
  if (!m) return null;
  const raw = parseInt(m[1], 16);
  return { raw, underVoltage: !!(raw & 0x1), frequencyCapped: !!(raw & 0x2), throttled: !!(raw & 0x4), softTempLimit: !!(raw & 0x8), underVoltageEver: !!(raw & 0x10000), throttledEver: !!(raw & 0x40000) };
}

/** MemAvailable (what can be used without swapping) and swap, from /proc/meminfo text. */
export function parseMeminfo(text: string): { availableBytes: number | null; swap: { totalBytes: number; usedBytes: number } | null } {
  const kb = (key: string) => { const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text); return m ? Number(m[1]) * 1024 : null; };
  const swapTotal = kb('SwapTotal'), swapFree = kb('SwapFree');
  return { availableBytes: kb('MemAvailable'), swap: swapTotal != null && swapFree != null ? { totalBytes: swapTotal, usedBytes: swapTotal - swapFree } : null };
}

const readText = (path: string) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const sizeOf = (path: string) => { try { return statSync(path).size; } catch { return 0; } };

function disk(label: string, path: string, systemDev: number | null): DiskInfo | null {
  try {
    const real = realpathSync(path);
    const s = statfsSync(real), st = statSync(real);
    return { label, path: real, freeBytes: Number(s.bavail) * s.bsize, totalBytes: Number(s.blocks) * s.bsize, device: st.dev, system: systemDev != null && st.dev === systemDev };
  } catch { return null; }
}

function throttleNow(): Promise<Throttle | null> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn('vcgencmd', ['get_throttled'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => { child.kill(); resolve(null); }, 2000);
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', () => { clearTimeout(timer); resolve(parseThrottled(out)); });
    } catch { resolve(null); }
  });
}

let probeCache: { at: number; dir: string; value: HealthSnapshot['probe'] } | null = null;
/** 4 KB written and synced, then read back and removed. Cached for 30 s so a page that polls cannot turn it into steady writing. */
export function diskProbe(dir: string, now = Date.now()): HealthSnapshot['probe'] {
  if (probeCache && probeCache.dir === dir && now - probeCache.at < 30_000) return probeCache.value;
  let value: HealthSnapshot['probe'] = null;
  const path = join(dir, `.probe-${process.pid}`);
  try {
    // three tries, the best one counts: a drive that was asleep (an external disk) is slow only on the first, a failing one on every try
    const buf = Buffer.alloc(4096, 7);
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const fd = openSync(path, 'w');
      writeSync(fd, buf); fsyncSync(fd); closeSync(fd);
      const t1 = performance.now();
      const rd = openSync(path, 'r'); readSync(rd, Buffer.alloc(4096), 0, 4096, 0); closeSync(rd);
      const t2 = performance.now();
      const one = { writeMs: Math.round((t1 - t0) * 10) / 10, readMs: Math.round((t2 - t1) * 10) / 10 };
      if (!value || one.writeMs < value.writeMs) value = one;
    }
  } catch { value = null; }
  finally { try { unlinkSync(path); } catch { /* not created */ } }
  probeCache = { at: now, dir, value };
  return value;
}

export async function collectHealth(dataDir: string): Promise<HealthSnapshot> {
  const root = (() => { try { return statSync('/').dev; } catch { return null; } })();
  const mem = parseMeminfo(readText('/proc/meminfo') ?? '');
  const temp = readText('/sys/class/thermal/thermal_zone0/temp');
  const [l1, l5, l15] = loadavg();
  const db = join(dataDir, 'turbomusic.db');
  const disks = [
    disk('Library files', join(dataDir, 'files'), root), disk('Database', dataDir, root), disk('Temporary files', join(dataDir, 'tmp'), root), disk('System', '/', root),
  ].filter((d): d is DiskInfo => !!d);
  return {
    at: Date.now(), host: hostname(), platform: platform(), arch: arch(), node: process.version,
    uptimeS: Math.round(uptime()), processUptimeS: Math.round(process.uptime()),
    cpu: { cores: cpus().length || 1, load1: l1, load5: l5, load15: l15 },
    memory: { totalBytes: totalmem(), availableBytes: mem.availableBytes ?? freemem(), rssBytes: process.memoryUsage.rss() },
    swap: mem.swap,
    tempC: temp && Number.isFinite(Number(temp)) ? Math.round(Number(temp) / 100) / 10 : null,
    throttle: await throttleNow(),
    disks,
    probe: existsSync(join(dataDir, 'tmp')) ? diskProbe(join(dataDir, 'tmp')) : null,
    db: { bytes: sizeOf(db), walBytes: sizeOf(`${db}-wal`) },
  };
}

const GB = 1024 ** 3;
/** What deserves a look, in plain words. Pure: the thresholds are the Raspberry Pi's own (80 C is where it starts slowing down). */
export function assessHealth(h: HealthSnapshot): Warning[] {
  const out: Warning[] = [];
  for (const d of h.disks) {
    if (d.label === 'System' && h.disks.some((x) => x.label !== 'System' && x.device === d.device && x.label !== 'Temporary files')) continue; // reported under the library's name
    const frac = d.totalBytes ? d.freeBytes / d.totalBytes : 1;
    if (d.freeBytes < 1 * GB || frac < 0.03) out.push({ level: 'bad', id: `disk-${d.label}`, message: `${d.label}: only ${(d.freeBytes / GB).toFixed(1)} GB free (${d.path}).` });
    else if (d.freeBytes < 5 * GB || frac < 0.1) out.push({ level: 'warn', id: `disk-${d.label}`, message: `${d.label}: getting full, ${(d.freeBytes / GB).toFixed(1)} GB free (${d.path}).` });
  }
  const onSystem = h.disks.filter((d) => d.system && d.label !== 'System');
  if (onSystem.length) out.push({ level: 'warn', id: 'sd-card', message: `${onSystem.map((d) => d.label).join(', ')} ${onSystem.length === 1 ? 'is' : 'are'} on the same disk as the operating system (${onSystem[0].path}). On a Raspberry Pi that is the SD card, which wears out with writes: put the data folder on the external drive, or move the folders under Storage locations.` });
  if (h.tempC != null) {
    if (h.tempC >= 80) out.push({ level: 'bad', id: 'temp', message: `CPU is ${h.tempC} °C: it slows itself down from here. Check cooling.` });
    else if (h.tempC >= 70) out.push({ level: 'warn', id: 'temp', message: `CPU is warm: ${h.tempC} °C.` });
  }
  if (h.throttle?.underVoltage) out.push({ level: 'bad', id: 'undervoltage', message: 'The power supply is too weak right now (under-voltage). Use the official supply and a short cable; a weak one also corrupts SD cards and drives.' });
  else if (h.throttle?.underVoltageEver) out.push({ level: 'warn', id: 'undervoltage', message: 'The power supply dipped too low at some point since the last boot.' });
  if (h.throttle?.throttled || h.throttle?.frequencyCapped) out.push({ level: 'warn', id: 'throttled', message: 'The CPU is being slowed down right now (heat or power).' });
  const avail = h.memory.totalBytes ? h.memory.availableBytes / h.memory.totalBytes : 1;
  if (avail < 0.08) out.push({ level: 'bad', id: 'memory', message: `Memory is almost all used (${Math.round(h.memory.availableBytes / 1048576)} MB available).` });
  else if (avail < 0.15) out.push({ level: 'warn', id: 'memory', message: `Memory is getting low (${Math.round(h.memory.availableBytes / 1048576)} MB available).` });
  if (h.swap && h.swap.totalBytes && h.swap.usedBytes / h.swap.totalBytes > 0.5) out.push({ level: 'warn', id: 'swap', message: 'More than half the swap is in use. Swap on an SD card is slow and wears it; free memory or add RAM.' });
  if (h.cpu.load5 > h.cpu.cores * 1.5) out.push({ level: 'warn', id: 'load', message: `The CPU has been busy (load ${h.cpu.load5.toFixed(1)} on ${h.cpu.cores} cores).` });
  if (h.probe && h.probe.writeMs > 500) out.push({ level: 'warn', id: 'slow-disk', message: `The disk is slow to write right now (${h.probe.writeMs} ms for 4 KB). A failing or very full drive or SD card does this.` });
  if (h.db.walBytes > 256 * 1048576) out.push({ level: 'warn', id: 'wal', message: 'The database journal is unusually large; restarting the server clears it.' });
  return out;
}
