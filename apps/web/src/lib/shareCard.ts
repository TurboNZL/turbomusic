import { shapes, type Motif } from '../components/AbstractArt.tsx';

/**
 * A share picture for a recap, drawn on a canvas (no libraries, no pictures fetched: a gradient, the numbers and the lists), 1080 x 1920 (9:16). This is only the fallback: the normal picture is a photograph of the card itself (exportImage.ts).
 * `drawShareCard` returns a PNG; `saveOrShare` hands it to the system share sheet when the browser can share files, else downloads it.
 */
export interface ShareCardSpec {
  kicker: string;
  title: string;
  big: { value: string; label: string };
  sections: { heading: string; rows: string[] }[];
  footer: string;
  /** two CSS colours for the background gradient */
  colors?: [string, string];
  /** the abstract background: the same seed and motif as the page's art */
  art?: { seed: string; motif: Motif };
}

const W = 1080, H = 1920, FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function drawShareCard(spec: ShareCardSpec): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the picture.');
  const [a, b] = spec.colors ?? ['#7c3aed', '#1e1b4b'];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (spec.art) {
    // the page's own SVG shapes (400 x 600, "slice" fit), drawn with Path2D
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
    for (const sh of shapes(spec.art.seed, spec.art.motif, { w: W, h: H })) {
      ctx.globalAlpha = sh.opacity; ctx.lineWidth = sh.width;
      const path = new Path2D(sh.kind === 'path' ? sh.d : `M${sh.cx - sh.r} ${sh.cy}a${sh.r} ${sh.r} 0 1 0 ${sh.r * 2} 0a${sh.r} ${sh.r} 0 1 0 ${-sh.r * 2} 0Z`);
      if (sh.fill) ctx.fill(path); else ctx.stroke(path);
    }
    ctx.restore(); ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.arc(W - 120, 200, 380, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(60, H - 80, 320, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  const LEFT = 90, LW = W - 180;
  ctx.font = `600 34px ${FONT}`; ctx.globalAlpha = 0.8; ctx.fillText(spec.kicker.toUpperCase(), LEFT, 200); ctx.globalAlpha = 1;
  ctx.font = `800 70px ${FONT}`; ctx.fillText(fit(ctx, spec.title, LW), LEFT, 285);
  ctx.font = `900 190px ${FONT}`; ctx.fillText(fit(ctx, spec.big.value, LW), LEFT, 520);
  ctx.font = `500 38px ${FONT}`; ctx.globalAlpha = 0.85; ctx.fillText(fit(ctx, spec.big.label, LW), LEFT, 586); ctx.globalAlpha = 1;
  spec.sections.slice(0, 4).forEach((sec, i) => {
    const y = 720 + i * 285;
    ctx.font = `700 28px ${FONT}`; ctx.globalAlpha = 0.75; ctx.fillText(sec.heading.toUpperCase(), LEFT, y); ctx.globalAlpha = 1;
    ctx.font = `600 34px ${FONT}`;
    sec.rows.slice(0, 4).forEach((r, k) => ctx.fillText(fit(ctx, `${k + 1}  ${r}`, LW), LEFT, y + 52 + k * 47));
  });
  ctx.font = `500 30px ${FONT}`; ctx.globalAlpha = 0.7; ctx.fillText(spec.footer, LEFT, H - 80); ctx.globalAlpha = 1;
  return new Promise((res, rej) => c.toBlob((bl) => (bl ? res(bl) : rej(new Error('Could not make the picture.'))), 'image/png'));
}

/** What the Android app offers for pictures (a WebView cannot download a blob: link by itself). */
interface AndroidImages { saveImage?(name: string, base64: string): string; shareImage?(name: string, base64: string): string }
const androidImages = () => (window as unknown as { TurboMusicAndroid?: AndroidImages }).TurboMusicAndroid;

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type SaveResult = 'shared' | 'saved' | 'manual';

/**
 * Gets the picture to the person. In the Android app: the app saves it to Pictures/TurboMusic (or opens the share sheet). In a browser:
 * the system share sheet when it can share files, else a download. Share sheets only open straight after a tap, and making the picture takes
 * a few seconds, so when the browser refuses (iPhones, mostly) this returns 'manual' and the caller shows the picture with its own Save and
 * Share buttons, which are a fresh tap.
 */
export async function saveOrShare(blob: Blob, name: string, opts: { fresh?: boolean } = {}): Promise<SaveResult> {
  const bridge = androidImages();
  if (bridge?.saveImage) {
    const r = bridge.saveImage(name, await toBase64(blob));
    if (r === 'saved' || r === 'shared') return r;
    throw new Error(r);
  }
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; }
    catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
      if (!opts.fresh) return 'manual'; // the tap has expired: ask for another
    }
  }
  const touchOnly = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  if (touchOnly && !opts.fresh) return 'manual'; // phones often ignore a silent download; show the picture instead
  downloadBlob(blob, name);
  return 'saved';
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.png`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** The share sheet, from a fresh tap. */
export async function shareBlob(blob: Blob, name: string): Promise<boolean> {
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.canShare?.({ files: [file] })) return false;
  try { await nav.share({ files: [file], title: name }); return true; } catch (e) { return (e as Error).name === 'AbortError'; }
}
