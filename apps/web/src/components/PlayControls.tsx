import { useState } from 'react';
import { ListEnd, ListStart, Play, Shuffle } from 'lucide-react';
import { shuffleWithRules } from '@turbomusic/core';
import { usePlayer } from '../lib/player.ts';
import { useLibrary } from '../lib/derive.ts';
import { cn } from '../lib/cn.ts';

const KEY = 'turbomusic.playlistShuffle';
export const readShuffle = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const writeShuffle = (v: boolean) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private window */ } };
/** The one Shuffle switch (kept per device) shared by every page that plays a list: playlists, artists. */
export function useShuffleSwitch(): [boolean, () => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => setOn((v) => { const n = !v; try { localStorage.setItem(KEY, n ? '1' : '0'); } catch { /* private window */ } return n; });
  return [on, toggle];
}

/** Play, the Shuffle switch, "Replace lineup" and "Add to lineup" for a list of playable track ids: the same row on playlists and artists. */
export function PlayControls({ ids, source, label = 'this list', lineup = true }: { ids: string[]; source: { type: 'playlist' | 'search' | 'album'; id: string | null }; label?: string; /** false on the whole-library lists (every track, every album): replacing or extending the lineup with thousands of songs makes no sense there */ lineup?: boolean }) {
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
      <button className={cn('btn', shuffleOn && 'btn-accent')} aria-pressed={shuffleOn} onClick={toggleShuffle} title={shuffleOn ? 'Shuffle is on: Play, Replace lineup and Add to lineup mix the list' : 'Shuffle is off: they keep the list order'}><Shuffle size={16} /><span className="max-sm:sr-only">Shuffle {shuffleOn ? 'on' : 'off'}</span></button>
      {lineup && hasCurrent && <div className="contents max-sm:hidden">
        <button className="btn" disabled={!ids.length} title={`Keep playing the current track, then continue with ${label} instead of what was coming next`} onClick={() => replaceRest(ordered(), source)}><ListStart size={16} />Replace lineup</button>
        <button className="btn btn-ghost" disabled={!ids.length} title={`Add ${label} to the end of what is coming next`} onClick={() => appendRest(ordered())}><ListEnd size={16} />Add to lineup</button>
      </div>}
    </>
  );
}
