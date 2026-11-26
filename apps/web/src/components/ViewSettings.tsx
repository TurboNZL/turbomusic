import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useStore } from '../lib/store.ts';
import { Select } from './Select.tsx';

/** Settings > Appearance: the size of everything. Applied when you let go, so the page does not reflow under the slider. */
export function UiScaleCard() {
  const { settings, updateSettings } = useStore();
  const [v, setV] = useState(settings.uiScale);
  useEffect(() => setV(settings.uiScale), [settings.uiScale]);
  const commit = (n = v) => { if (n !== settings.uiScale) updateSettings({ uiScale: n }); };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input type="range" aria-label="Interface size" className="bt-range bt-hit w-full max-w-sm" style={{ '--p': `${((v - 0.7) / 0.9) * 100}%` } as React.CSSProperties} min={0.7} max={1.6} step={0.05} value={v}
          onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => commit()} onKeyUp={() => commit()} onBlur={() => commit()} />
        <span className="w-12 text-sm tabular-nums">{Math.round(v * 100)}%</span>
        <button className="btn btn-ghost !p-1.5" aria-label="Back to 100%" title="Back to 100%" disabled={settings.uiScale === 1 && v === 1} onClick={() => { setV(1); commit(1); }}><RotateCcw size={14} /></button>
      </div>
      <p className="text-xs text-muted">Makes text and spacing bigger or smaller on this device. Use it when a screen is too small for everything to fit.</p>
    </div>
  );
}

/** Settings > Playback: how the full-screen player opens. */
export function NowPlayingSettings() {
  const { settings, updateSettings } = useStore();
  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={settings.nowRemember} onChange={(e) => updateSettings({ nowRemember: e.target.checked })} /><span>Open it the way I left it <span className="text-muted">(lyrics on or off and the controls you chose, remembered on this device)</span></span></label>
      <div className={settings.nowRemember ? 'pointer-events-none space-y-3 opacity-40' : 'space-y-3'}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.nowLyrics} onChange={(e) => updateSettings({ nowLyrics: e.target.checked })} />Show the lyrics</label>
        <label className="block space-y-1 text-sm">Controls
          <Select value={settings.nowControls} onChange={(v) => updateSettings({ nowControls: v as 'none' | 'bar' | 'full' })}
            options={[{ value: 'bar', label: 'Play bar (seek, previous, play, next)' }, { value: 'full', label: 'Everything (rating, thumbs, volume, info, queue)' }, { value: 'none', label: 'None' }]} /></label>
      </div>
    </div>
  );
}

/** Settings > Playback: the Rank page. */
export function RankSettings() {
  const { settings, updateSettings } = useStore();
  return (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 shrink-0" checked={settings.rankWithAudio} onChange={(e) => updateSettings({ rankWithAudio: e.target.checked })} /><span>Only compare songs that have audio <span className="text-muted">(so every card can be previewed; with fewer than two such songs all of them are used)</span></span></label>
  );
}
