/**
 * A share picture for a recap, drawn on a canvas (no libraries, no pictures fetched: a gradient, the numbers and the lists), 1080 x 1350.
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
}

const W = 1080, H = 1350, FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.arc(W - 120, 150, 330, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(80, H - 60, 260, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  ctx.font = `600 34px ${FONT}`; ctx.globalAlpha = 0.8; ctx.fillText(spec.kicker.toUpperCase(), 72, 110); ctx.globalAlpha = 1;
  ctx.font = `800 70px ${FONT}`; ctx.fillText(fit(ctx, spec.title, W - 144), 72, 190);
  ctx.font = `900 150px ${FONT}`; ctx.fillText(fit(ctx, spec.big.value, W - 144), 72, 360);
  ctx.font = `500 38px ${FONT}`; ctx.globalAlpha = 0.85; ctx.fillText(spec.big.label, 72, 418); ctx.globalAlpha = 1;

  const cols = spec.sections.length > 2 ? 2 : spec.sections.length || 1, colW = (W - 144 - (cols - 1) * 48) / cols;
  const rowsY0 = 500;
  spec.sections.forEach((s, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 72 + col * (colW + 48), y = rowsY0 + row * 360;
    ctx.font = `700 30px ${FONT}`; ctx.globalAlpha = 0.75; ctx.fillText(s.heading.toUpperCase(), x, y); ctx.globalAlpha = 1;
    ctx.font = `600 36px ${FONT}`;
    s.rows.slice(0, 5).forEach((r, k) => ctx.fillText(fit(ctx, `${k + 1}  ${r}`, colW), x, y + 56 + k * 52));
  });
  ctx.font = `500 30px ${FONT}`; ctx.globalAlpha = 0.7; ctx.fillText(spec.footer, 72, H - 64); ctx.globalAlpha = 1;
  return new Promise((res, rej) => c.toBlob((bl) => (bl ? res(bl) : rej(new Error('Could not make the picture.'))), 'image/png'));
}

/** Shares the picture through the system sheet when files can be shared, else saves it. Returns what happened. */
export async function saveOrShare(blob: Blob, name: string): Promise<'shared' | 'saved'> {
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'shared'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.png`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}
