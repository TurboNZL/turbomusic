import { toBlob } from 'html-to-image';

/** The size a recap card is drawn at on screen (CSS pixels, 9:16 portrait); the picture is this times `EXPORT_SCALE` = 1080 x 1920. */
export const STAGE_W = 720, STAGE_H = 1280, EXPORT_SCALE = 1.5;

/** Wait until the pictures inside `el` have loaded (covers come from the device or the server), or give up after `ms`. */
export async function imagesReady(el: HTMLElement, ms = 6000) {
  const t0 = Date.now();
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  while (Date.now() - t0 < ms) {
    const imgs = [...el.querySelectorAll('img')];
    if (imgs.every((i) => i.complete)) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** A card that is on the page, as a 1920 x 1080 PNG: what is drawn is the card itself, not a second drawing of it. */
export async function elementToPng(el: HTMLElement): Promise<Blob> {
  await imagesReady(el);
  const opts = { width: STAGE_W, height: STAGE_H, pixelRatio: EXPORT_SCALE, cacheBust: false, style: { transform: 'none', left: '0', top: '0', position: 'static' } } as const;
  // the first pass lets the browser fetch and decode the pictures it inlines; the second is the one that is kept
  await toBlob(el, opts).catch(() => null);
  const blob = await toBlob(el, opts);
  if (!blob) throw new Error('Could not make the picture.');
  return blob;
}
