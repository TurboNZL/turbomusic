import { useState } from 'react';
import { ListEnd, ListStart, Play, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { usePlayer } from '../lib/player.ts';
import { useLibrary } from '../lib/derive.ts';
import { cn } from '../lib/cn.ts';

const KEY = 'turbomusic.playlistShuffle';
/** The one Shuffle switch (kept per device) shared by every page that plays a list: playlists, artists. */
export function useShuffleSwitch(): [boolean, () => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => setOn((v) => { const n = !v; try { localStorage.setItem(KEY, n ? '1' : '0'); } catch { /* private window */ } return n; });
  return [on, toggle];
}

/** Play, the Shuffle switch, "Then: replace" and "Add to Then" for a list of playable track ids: the same row on playlists and artists. */
export function PlayControls({ ids, source, label = 'this list' }: { ids: string[]; source: { type: 'playlist' | 'search'; id: string | null }; label?: string }) {
  const lib = useLibrary();
  const play = usePlayer((s) => s.play);
  const replaceRest = usePlayer((s) => s.replaceRest);
  const appendRest = usePlayer((s) => s.appendRest);
  const hasCurrent = usePlayer((s) => !!s.queue.currentId);
  const [shuffleOn, toggleShuffle] = useShuffleSwitch();
  const ordered = () => (shuffleOn ? shuffleWithRules(ids, lib.rules) : ids);
  return (
    <>
      <button className="btn btn-accent" disabled={!ids.length} onClick={() => { const o = ordered(); play(o[0], o, source); }}><Play size={16} fill="currentColor" />Play</button>
      <button className={cn('btn', shuffleOn && 'btn-accent')} aria-pressed={shuffleOn} onClick={toggleShuffle} title={shuffleOn ? 'Shuffle is on: Play, Then and Add to Then mix the list' : 'Shuffle is off: they keep the list order'}><Shuffle size={16} />Shuffle {shuffleOn ? 'on' : 'off'}</button>
      {hasCurrent && <>
        <button className="btn" disabled={!ids.length} title={`Keep playing the current track, then continue with ${label} instead of what was coming next`} onClick={() => replaceRest(ordered(), source)}><ListStart size={16} />Then: replace</button>
        <button className="btn btn-ghost" disabled={!ids.length} title={`Add ${label} to the end of what is coming next`} onClick={() => appendRest(ordered())}><ListEnd size={16} />Add to Then</button>
      </>}
    </>
  );
}
