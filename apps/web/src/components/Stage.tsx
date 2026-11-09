import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import { AbstractArt, type Motif } from './AbstractArt.tsx';
import { STAGE_H, STAGE_W } from '../lib/exportImage.ts';

/**
 * The card of a recap or a Wrapped slide: always 720 x 1280 (9:16, like a phone story), designed in those pixels. `Stage` scales it to whatever space
 * there is (and can go full screen), `StageFrame` is the card itself, which is also what gets saved as a picture, so what you see is
 * what you save.
 */
export function StageFrame({ bg, art, children, className = '' }: { bg: string; art?: { seed: string; motif: Motif }; children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden text-white ${className}`} style={{ width: STAGE_W, height: STAGE_H, background: bg, fontFamily: 'var(--font, system-ui, sans-serif)' } as CSSProperties}>
      {art && <AbstractArt seed={art.seed} motif={art.motif} size={{ w: STAGE_W, h: STAGE_H }} />}
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

export function Stage({ children, overlay, className = '' }: { children: ReactNode; /** drawn over the card at screen size (progress bar, tap zones) */ overlay?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  const [full, setFull] = useState(false);
  const native = useRef(false);
  // the box is measured again when it moves into / out of full screen (it is a different element then)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H) || 0.5);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('orientationchange', fit);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', fit); };
  }, [full]);
  // Full screen works everywhere: the browser's own full screen where it exists (not on iPhones, and not for an element in some web views),
  // otherwise the card fills the window by itself. Either way it is portalled to <body>, so no page animation can break `fixed`.
  useEffect(() => {
    if (!full) return;
    native.current = false;
    const el = box.current;
    void el?.requestFullscreen?.().then(() => { native.current = true; }).catch(() => undefined);
    const onChange = () => { if (native.current && !document.fullscreenElement) setFull(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [full]);
  const node = (
    <div ref={box} className={`relative mx-auto overflow-hidden bg-black ${full ? 'fixed inset-0 z-[300] m-0 h-[100dvh] w-screen' : 'rounded-theme shadow-xl'} ${full ? '' : className}`}
      style={full ? { touchAction: 'manipulation', paddingBottom: 'env(safe-area-inset-bottom)' } : { aspectRatio: '9 / 16', height: 'min(80dvh, 56rem)', maxWidth: '100%' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${k})`, transformOrigin: 'center' }}>{children}</div>
      {overlay}
      <button onClick={() => setFull(!full)} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'}
        className={`absolute z-20 rounded-full bg-black/45 text-white/90 backdrop-blur hover:bg-black/65 hover:text-white ${full ? 'right-3 top-6 p-2.5' : 'bottom-2 right-2 p-1.5'}`} style={full ? { top: 'max(1.5rem, env(safe-area-inset-top))' } : undefined}>{full ? <Minimize2 size={20} /> : <Maximize2 size={15} />}</button>
    </div>
  );
  return full ? createPortal(node, document.body) : node;
}
