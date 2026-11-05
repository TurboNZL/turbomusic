import { useMemo } from 'react';

/**
 * Generative abstract backgrounds for the recaps and Wrapped: soft white shapes on whatever colour is behind them. Each is drawn from a seed
 * (the same seed always draws the same picture) in one of six motifs, and drifts slowly (off with reduced motion). `shapes()` is pure.
 */
export type Motif = 'rings' | 'blobs' | 'waves' | 'dots' | 'stripes' | 'arcs';
export const MOTIFS: Motif[] = ['rings', 'blobs', 'waves', 'dots', 'stripes', 'arcs'];

export type Shape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean; width: number; opacity: number; drift: number }
  | { kind: 'path'; d: string; fill?: boolean; width: number; opacity: number; drift: number };

export const W = 400, H = 600;

export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A smooth closed blob: `n` points around a centre with random radii, joined by Catmull-Rom curves. */
function blobPath(r: () => number, cx: number, cy: number, radius: number, n = 7): string {
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, d = radius * (0.65 + r() * 0.5); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; });
  const p = (i: number) => pts[(i + n) % n];
  let d = `M${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

export function shapes(seed: string, motif: Motif, size: { w: number; h: number } = { w: W, h: H }): Shape[] {
  const r = rng(`${seed}:${motif}`), out: Shape[] = [];
  const between = (a: number, b: number) => a + r() * (b - a);
  // the shapes are drawn for a 400 x 600 page; a wider page stretches positions and keeps shapes round (sizes follow the geometric mean)
  const sx = size.w / W, sy = size.h / H, k = Math.sqrt(sx * sy), WW = size.w, HH = size.h;
  if (motif === 'rings') {
    for (let c = 0; c < 2; c++) {
      const cx = between(60, 340) * sx, cy = between(80, 520) * sy, step = between(26, 40) * k;
      for (let i = 1; i <= 6; i++) out.push({ kind: 'circle', cx, cy, r: i * step, width: between(1, 3), opacity: 0.22 - i * 0.02 + 0.02, drift: c });
    }
  } else if (motif === 'blobs') {
    for (let i = 0; i < 4; i++) out.push({ kind: 'path', d: blobPath(r, between(40, 360) * sx, between(60, 540) * sy, between(70, 150) * k), fill: true, width: 0, opacity: between(0.07, 0.16), drift: i });
    out.push({ kind: 'path', d: blobPath(r, between(120, 280) * sx, between(200, 400) * sy, between(90, 120) * k), width: 2, opacity: 0.25, drift: 4 });
  } else if (motif === 'waves') {
    const rows = 7;
    for (let i = 0; i < rows; i++) {
      const y = (i + 0.5) * (HH / rows), amp = between(14, 42) * k, len = between(120, 220) * k, phase = r() * len;
      let d = `M-20 ${y}`;
      for (let x = -20; x <= WW + 20; x += 10) d += `L${x} ${(y + Math.sin(((x + phase) / len) * Math.PI * 2) * amp).toFixed(1)}`;
      out.push({ kind: 'path', d, width: between(1.5, 4), opacity: between(0.12, 0.3), drift: i });
    }
  } else if (motif === 'dots') {
    const cx = between(100, 300) * sx, cy = between(150, 450) * sy, reach = between(160, 260) * k, gap = 26 * k;
    for (let y = 10; y < HH; y += gap) for (let x = 10; x < WW; x += gap) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > reach) continue;
      out.push({ kind: 'circle', cx: x, cy: y, r: Math.max(0.8, 5.5 * k * (1 - d / reach)), fill: true, width: 0, opacity: 0.12 + 0.25 * (1 - d / reach), drift: 0 });
    }
  } else if (motif === 'stripes') {
    const n = Math.ceil(7 * sx), gap = between(46, 66) * sx, w0 = between(8, 30) * sx;
    for (let i = -2; i < n; i++) {
      const x = i * gap + 20, w = w0 * (0.5 + r());
      out.push({ kind: 'path', d: `M${x} -20L${x + w} -20L${x + w + 360 * k} ${HH + 20}L${x + 360 * k} ${HH + 20}Z`, fill: true, width: 0, opacity: between(0.05, 0.16), drift: i & 1 });
    }
  } else {
    const corners: [number, number][] = [[0, 0], [WW, 0], [0, HH], [WW, HH]];
    for (let c = 0; c < 2; c++) {
      const [cx, cy] = corners[Math.floor(r() * 4)];
      for (let i = 1; i <= 6; i++) out.push({ kind: 'circle', cx, cy, r: i * between(42, 58) * k, fill: i % 2 === 0, width: i % 2 === 0 ? 0 : 3, opacity: i % 2 === 0 ? 0.07 : 0.22, drift: c });
    }
  }
  return out;
}

/** Fills its (relatively positioned) parent behind the content. */
export function AbstractArt({ seed, motif, className = '', size = { w: W, h: H } }: { seed: string; motif: Motif; className?: string; size?: { w: number; h: number } }) {
  const list = useMemo(() => shapes(seed, motif, size), [seed, motif, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg aria-hidden viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid slice" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}>
      {list.map((s, i) => {
        const common = { className: `rc-float rc-float-${s.drift % 3}`, opacity: s.opacity, fill: s.fill ? '#fff' : 'none', stroke: s.fill ? 'none' : '#fff', strokeWidth: s.width };
        return s.kind === 'circle' ? <circle key={i} {...common} cx={s.cx} cy={s.cy} r={s.r} /> : <path key={i} {...common} d={s.d} />;
      })}
    </svg>
  );
}
