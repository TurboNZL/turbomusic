import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../lib/presence.ts';
import { cn } from '../lib/cn.ts';

/**
 * A panel that opens above the player bar, grown out of the control that opened it, in the active UI style's menu
 * animation (and its exit animation). Desktop: anchored over `anchor`; phone: centred (auto side margins) above the bar.
 * It closes on Escape and on a press outside, unless `pinned`. Presses on `[data-popover-trigger]` are ignored
 * because the trigger toggles the panel itself.
 */
export function Popover({ open, anchor, onClose, align = 'left', pinned = false, label, className, children }: {
  open: boolean; anchor: HTMLElement | null; onClose: () => void; align?: 'left' | 'right'; pinned?: boolean; label: string; className?: string; children: ReactNode;
}) {
  const { mounted, leaving } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!mounted) return;
    const place = () => {
      const bar = document.querySelector('.bt-player')?.getBoundingClientRect();
      const a = anchor?.getBoundingClientRect();
      const bottom = window.innerHeight - (bar?.top ?? a?.top ?? window.innerHeight) + 10;
      if (window.innerWidth < 768 || !a) { setPos({ left: 12, right: 12, marginInline: 'auto', bottom, maxHeight: `calc(100dvh - ${bottom}px - 4.5rem)`, overflowY: 'auto', transformOrigin: `${a ? a.left + a.width / 2 - 12 : 100}px 100%` }); return; }
      const w = ref.current?.offsetWidth ?? 320;
      const left = align === 'left' ? Math.max(12, Math.min(a.left, window.innerWidth - w - 12)) : Math.max(12, Math.min(a.right - w, window.innerWidth - w - 12));
      setPos({ left, bottom, transformOrigin: `${Math.max(0, a.left + a.width / 2 - left)}px 100%` });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [mounted, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const el = e.target as Element;
      if (pinned || ref.current?.contains(el) || el.closest?.('[data-popover-trigger]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open, pinned, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} data-leaving={leaving || undefined} className={cn('bt-menu bt-popover fixed z-[55] overflow-hidden', className)} style={pos}>{children}</div>,
    document.body);
}
