/** The now-playing widget's options and the address that carries them (the page itself is packages/server/src/widget.ts: keep both lists in step). */
export const WIDGET_SKINS = [
  { id: 'compact', label: 'Compact' }, { id: 'boxy', label: 'Boxy' }, { id: 'gallery', label: 'Gallery' },
  { id: 'minimal', label: 'Minimal' }, { id: 'macos', label: 'macOS' }, { id: 'discord', label: 'Discord' },
] as const;
export const WIDGET_COVERS = [{ id: 'square', label: 'Square' }, { id: 'vinyl', label: 'Vinyl' }, { id: 'none', label: 'None' }] as const;

export interface WidgetOptions {
  skin: (typeof WIDGET_SKINS)[number]['id'];
  cover: (typeof WIDGET_COVERS)[number]['id'];
  glow: boolean; blur: boolean; progress: boolean;
  /** '' = the colour of TurboMusic's own accent */
  accent: string;
  /** transparent for OBS, solid for an ordinary window */
  bg: 'transparent' | 'dark' | 'light';
  scale: number;
  /** card width in px, the same for every skin */
  width: number;
  /** card height in px; 0 = fits its content */
  height: number;
  hidePaused: boolean;
  /** seconds the widget shows after a song changes; 0 = always */
  songChange: number;
  /** shown when nothing plays; '' = the placeholder */
  idle: string;
}
export const DEFAULT_WIDGET: WidgetOptions = { skin: 'compact', cover: 'square', glow: true, blur: false, progress: true, accent: '', bg: 'transparent', scale: 1, width: 380, height: 0, hidePaused: false, songChange: 0, idle: '' };

/** Only options that differ from the defaults go in the address, so the link stays short and a later default change applies. */
export function widgetUrl(base: string, token: string, o: WidgetOptions): string {
  const q = new URLSearchParams({ token });
  const d = DEFAULT_WIDGET;
  if (o.skin !== d.skin) q.set('skin', o.skin);
  if (o.cover !== d.cover) q.set('cover', o.cover);
  if (o.glow) q.set('glow', '1');
  if (o.blur) q.set('blur', '1');
  if (!o.progress) q.set('progress', '0');
  if (o.accent) q.set('accent', o.accent.replace('#', ''));
  if (o.bg !== d.bg) q.set('bg', o.bg);
  if (o.scale !== d.scale) q.set('scale', String(o.scale));
  if (o.width !== d.width) q.set('w', String(Math.round(o.width)));
  if (o.height > 0) q.set('h', String(Math.round(o.height)));
  if (o.hidePaused) q.set('hide', 'paused');
  if (o.songChange > 0) q.set('songchange', String(o.songChange));
  if (o.idle) q.set('idle', o.idle);
  return `${base.replace(/\/+$/, '')}/widget?${q.toString()}`;
}
