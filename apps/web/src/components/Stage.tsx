import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    void box.current?.requestFullscreen?.().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined)).catch(() => undefined);
  };
  const canFull = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  return (
    <div ref={box} className={`relative mx-auto overflow-hidden bg-black ${full ? 'h-screen w-screen' : 'rounded-theme shadow-xl'} ${className}`} style={full ? undefined : { aspectRatio: '9 / 16', height: 'min(80dvh, 56rem)', maxWidth: '100%' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${k})`, transformOrigin: 'center' }}>{children}</div>
      {overlay}
      {canFull && <button onClick={toggle} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'}
        className="absolute bottom-2 right-2 z-20 rounded-full bg-black/40 p-1.5 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white">{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
    </div>
  );
}
