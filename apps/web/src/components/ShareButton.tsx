import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown } from 'lucide-react';
import { drawShareCard, saveOrShare, type ShareCardSpec } from '../lib/shareCard.ts';
import { elementToPng, STAGE_H, STAGE_W } from '../lib/exportImage.ts';
import { StaticRender } from '../lib/staticRender.ts';

/**
 * Saves or shares a card as a 1080 x 1920 picture. `render` draws the same card that is on screen, into a hidden 720 x 1280 copy that is
 * photographed, so the picture matches the page. If the browser cannot do that, the older plain drawing from `fallback` is used.
 */
export function ShareButton({ render, name, label = 'Save picture', fallback }: { render: () => ReactNode; name: string; label?: string; fallback?: ShareCardSpec }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [hosting, setHosting] = useState(false);
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
        await saveOrShare(blob, name);
        setState('done');
      } catch { if (!cancelled) setState('error'); }
      finally { if (!cancelled) { setHosting(false); setTimeout(() => setState('idle'), 2500); } }
    })();
    return () => { cancelled = true; };
  }, [hosting]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button className="btn" onClick={() => { setState('busy'); setHosting(true); }} disabled={state === 'busy'}><ImageDown size={15} />{state === 'busy' ? 'Making the picture…' : state === 'done' ? 'Done' : state === 'error' ? 'Could not make it' : label}</button>
      {hosting && createPortal(
        <StaticRender.Provider value>
          <div ref={host} aria-hidden className="rc-static" style={{ position: 'fixed', left: -30000, top: 0, width: STAGE_W, height: STAGE_H, pointerEvents: 'none' }}>{render()}</div>
        </StaticRender.Provider>, document.body)}
    </>
  );
}
