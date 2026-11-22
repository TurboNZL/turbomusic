import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, MonitorPlay } from 'lucide-react';
import { api, useStore } from '../lib/store.ts';
import { DEFAULT_WIDGET, WIDGET_COVERS, WIDGET_SKINS, widgetUrl, type WidgetOptions } from '../lib/widgetUrl.ts';
import { cn } from '../lib/cn.ts';
import { Select } from './Select.tsx';

const KEY = 'turbomusic.widget';
const load = (): WidgetOptions => { try { return { ...DEFAULT_WIDGET, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_WIDGET; } };

/** Settings > Server: the "now playing" widget for OBS (a Browser Source on the same network), a second screen, or an always-on-top window. */
export function WidgetCard() {
  const { settings } = useStore();
  const [o, setO] = useState(load);
  const set = (change: Partial<WidgetOptions>) => setO((cur) => { const next = { ...cur, ...change }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } return next; });
  const guess = settings.serverUrl || location.origin;
  const [base, setBase] = useState(guess);
  // OBS and a second-screen browser cannot send Cloudflare Access headers, so a tunnel address is blocked for them: the server's own
  // network address works (same Wi-Fi/LAN), and it is picked here when the server tells us what it is
  const [lan, setLan] = useState<string[]>([]);
  const viaTunnel = /^https:\/\//i.test(base) && !/\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base);
  useEffect(() => { if (!settings.token) return; api().status().then((st) => { setLan(st.lan ?? []); if (st.lan?.length && (/^https:\/\//i.test(guess) || /\/\/(localhost|127\.)/.test(guess))) setBase(st.lan[0]); }).catch(() => undefined); }, [settings.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => widgetUrl(base, settings.token, o), [base, settings.token, o]);
  const shown = reveal ? url : url.replace(/token=[^&]+/, 'token=••••••••').replace(viaTunnel ? /^https?:\/\/[^/]+/ : /$^/, 'https://••••••••');
  const loopback = /\/\/(localhost|127\.|\[::1\])/.test(base);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setReveal(true); } };
  const px = Math.round(o.width * o.scale);
  const slider = (label: string, key: 'width' | 'height', min: number, max: number, step: number, show: (n: number) => string) => (
    <label className="space-y-1 text-sm">{label}<div className="flex items-center gap-2"><input type="range" className="bt-range bt-hit flex-1" style={{ '--p': `${((o[key] - min) / (max - min)) * 100}%` } as React.CSSProperties} min={min} max={max} step={step} value={o[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} /><span className="w-16 text-right tabular-nums">{show(o[key])}</span></div></label>);
  const check = (key: keyof WidgetOptions, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={o[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} /><span>{label}{hint && <span className="text-muted"> ({hint})</span>}</span></label>);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Shows what is playing on any of your devices as a small card you can put on a stream or a second screen. In OBS add a <b>Browser Source</b> and paste the link; the background is see-through. It works on your home network (the address below must be one OBS can reach). It follows whichever device is playing, so the TurboMusic app or a phone must be connected to the server.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 text-sm"><div className="font-medium">Player</div>
          <div className="flex flex-wrap gap-1.5">{WIDGET_SKINS.map((s) => <button key={s.id} type="button" aria-pressed={o.skin === s.id} className={cn('chip cursor-pointer', o.skin === s.id ? 'bg-accent text-accent-fg' : 'hover:brightness-125')} onClick={() => set({ skin: s.id })}>{s.label}</button>)}</div></div>
        <div className="space-y-1.5 text-sm"><div className="font-medium">Cover</div>
          <div className="flex flex-wrap gap-1.5">{WIDGET_COVERS.map((s) => <button key={s.id} type="button" aria-pressed={o.cover === s.id} className={cn('chip cursor-pointer', o.cover === s.id ? 'bg-accent text-accent-fg' : 'hover:brightness-125')} onClick={() => set({ cover: s.id })}>{s.label}</button>)}</div></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {check('glow', 'Cover glow', 'a soft glow of the cover’s colours')}
        {check('blur', 'Cover blur', 'the cover, blurred, behind the text; not on Minimal')}
        {check('progress', 'Show the progress bar')}
        {check('hidePaused', 'Hide while paused or stopped')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Only show after a song changes<Select value={String(o.songChange)} onChange={(v) => set({ songChange: Number(v) })} options={[['0', 'Always visible'], ['5', 'For 5 seconds'], ['10', 'For 10 seconds'], ['15', 'For 15 seconds'], ['30', 'For 30 seconds']].map(([value, label]) => ({ value, label }))} /></label>
        <label className="space-y-1 text-sm">Background<Select value={o.bg} onChange={(v) => set({ bg: v as WidgetOptions['bg'] })} options={[{ value: 'transparent', label: 'See-through (OBS)' }, { value: 'dark', label: 'Solid dark (a window)' }, { value: 'light', label: 'Solid light (a window)' }]} /></label>
        <label className="space-y-1 text-sm">Size<div className="flex items-center gap-2"><input type="range" className="bt-range bt-hit flex-1" style={{ '--p': `${((o.scale - 0.5) / 2.5) * 100}%` } as React.CSSProperties} min={0.5} max={3} step={0.1} value={o.scale} onChange={(e) => set({ scale: Number(e.target.value) })} /><span className="w-10 text-right tabular-nums">{o.scale.toFixed(1)}×</span></div></label>
        {slider('Width', 'width', 240, 800, 10, (n) => `${n} px`)}
        {slider('Height', 'height', 0, 400, 10, (n) => (n === 0 ? 'Auto' : `${n} px`))}
        <label className="space-y-1 text-sm">Progress colour<div className="flex items-center gap-2"><input type="color" className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent" value={o.accent ? `#${o.accent.replace('#', '')}` : '#a855f7'} onChange={(e) => set({ accent: e.target.value })} /><button type="button" className="btn btn-ghost !py-1 text-xs" disabled={!o.accent} onClick={() => set({ accent: '' })}>Default</button></div></label>
      </div>
      <label className="block space-y-1 text-sm">Text when nothing is playing <span className="text-muted">(empty = “Nothing playing”)</span><input className="input" value={o.idle} onChange={(e) => set({ idle: e.target.value })} placeholder="Nothing playing" /></label>
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Preview</div>
        <div className="overflow-hidden rounded-theme border border-line" style={{ background: 'repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px' }}>
          {viaTunnel
            ? <div className="flex h-36 items-center justify-center p-4 text-center text-xs text-muted">No preview for a tunnel address: it would show Cloudflare’s sign-in page, with your address in it. Pick the network address below to preview.</div>
            : <iframe key={url} title="Widget preview" src={url} className="block w-full" style={{ height: Math.max(150, o.height > 0 ? o.height * o.scale + 24 : o.skin === 'gallery' ? px * 1.3 : px * 0.34), border: 0 }} />}
        </div>
        <p className="text-xs text-muted">Play something in the app to see it. The preview needs this page to be able to reach the server at the address below.</p>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Address of this server <span className="font-normal text-muted">(what OBS or another computer types to reach it)</span>
          <input className="input mt-1" type={viaTunnel && !reveal ? 'password' : 'text'} autoComplete="off" value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://192.168.1.20:47813" /></label>
        {lan.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-muted">Use this server's network address:{lan.map((a) => <button key={a} type="button" className={cn('chip', base === a && '!border-accent !text-accent')} onClick={() => setBase(a)}>{a}</button>)}</div>}
        {viaTunnel && <p className="text-xs text-warn">This address goes through your tunnel. OBS cannot send the Cloudflare Access sign-in, so Access will block it: use the network address above (same Wi-Fi or cable as the server), or add a Cloudflare Access “Bypass” policy for <code>/widget</code> and <code>/api/nowplaying</code> (the link's token still protects it).</p>}
        {loopback && <p className="text-xs text-warn">“localhost” only works on this computer. For OBS on another machine use this server’s network address (for example http://192.168.1.20:47813).</p>}
        <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-theme bg-raised px-3 py-2 text-xs" title="Contains your access token: treat it like a password">{shown}</code>
          <button type="button" className="btn btn-ghost !p-2" aria-label={reveal ? 'Hide the token' : 'Show the token'} onClick={() => setReveal((r) => !r)}>{reveal ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button type="button" className="btn btn-accent" onClick={() => void copy()} disabled={!settings.token}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}</button></div>
        <p className="flex items-start gap-1.5 text-xs text-muted"><MonitorPlay size={14} className="mt-0.5 shrink-0" />The link contains your access token, so anyone who has it can read what is playing. Do not show it on stream. To use it as an always-on-top overlay see the “Now playing on a panel or overlay” guide.</p>
      </div>
    </div>
  );
}
