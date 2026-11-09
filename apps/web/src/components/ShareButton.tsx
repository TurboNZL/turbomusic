import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, ImageDown, Share2 } from 'lucide-react';
import { downloadBlob, drawShareCard, saveOrShare, shareBlob, type ShareCardSpec } from '../lib/shareCard.ts';
import { elementToPng, STAGE_H, STAGE_W } from '../lib/exportImage.ts';
import { StaticRender } from '../lib/staticRender.ts';

/**
 * Saves or shares a card as a 1080 x 1920 picture. `render` draws the same card that is on screen, into a hidden 720 x 1280 copy that is
 * photographed, so the picture matches the page. If the browser cannot do that, the older plain drawing from `fallback` is used.
 */
export function ShareButton({ render, name, label = 'Save picture', fallback }: { render: () => ReactNode; name: string; label?: string; fallback?: ShareCardSpec }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [hosting, setHosting] = useState(false);
  const [manual, setManual] = useState<{ blob: Blob; url: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hosting) return;
    let cancelled = false;
    (async () => {
      try {
        let blob: Blob;
        try { blob = await elementToPng(host.current!); }
        catch (e) { if (!fallback) throw e; blob = await drawShareCard(fallback); }
        if (cancelled) return;
        const r = await saveOrShare(blob, name);
        if (cancelled) return;
        if (r === 'manual') { setManual({ blob, url: URL.createObjectURL(blob) }); setState('idle'); } else setState('done');
      } catch { if (!cancelled) setState('error'); }
      finally { if (!cancelled) { setHosting(false); setTimeout(() => setState('idle'), 2500); } }
    })();
    return () => { cancelled = true; };
  }, [hosting]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeManual = () => { if (manual) URL.revokeObjectURL(manual.url); setManual(null); };
  return (
    <>
      <button className="btn" onClick={() => { setState('busy'); setHosting(true); }} disabled={state === 'busy'}><ImageDown size={15} />{state === 'busy' ? 'Making the picture…' : state === 'done' ? 'Done' : state === 'error' ? 'Could not make it' : label}</button>
      {manual && createPortal(
        <div className="fixed inset-0 z-[400] flex flex-col items-center gap-3 overflow-y-auto bg-black/85 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" role="dialog" aria-modal="true" aria-label="Your picture" onClick={closeManual}>
          <img src={manual.url} alt="Your recap picture" className="max-h-[70dvh] max-w-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <p className="max-w-sm text-center text-sm text-white/80">Press and hold the picture to save it, or use the buttons.</p>
          <div className="flex flex-wrap justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button className="btn" onClick={() => { void shareBlob(manual.blob, name).then((ok) => { if (!ok) downloadBlob(manual.blob, name); }); }}><Share2 size={15} />Share</button>
            <button className="btn" onClick={() => downloadBlob(manual.blob, name)}><Download size={15} />Save file</button>
            <button className="btn" onClick={closeManual}>Close</button>
          </div>
        </div>, document.body)}
      {hosting && createPortal(
        <StaticRender.Provider value>
          <div ref={host} aria-hidden className="rc-static" style={{ position: 'fixed', left: -30000, top: 0, width: STAGE_W, height: STAGE_H, pointerEvents: 'none' }}>{render()}</div>
        </StaticRender.Provider>, document.body)}
    </>
  );
}
