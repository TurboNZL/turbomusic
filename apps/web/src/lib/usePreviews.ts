import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from './derive.ts';
import { fadeOut, loadPreview, middle, release, SNIPPET_MS, type Preview } from './preview.ts';
import { usePlayer } from './player.ts';

/**
 * 15-second previews (from the middle of a track) for a few tracks on screen, the same way the Rank page does them: every track is
 * buffered as soon as it appears so a tap starts at once, the music player is paused while one plays, and the volume follows the
 * player's slider. Used by the home page's ranking questions.
 */
export function usePreviews(tracks: Track[], enabled = true) {
  const key = enabled ? tracks.map((t) => t.id).join('|') : '';
  const map = useRef(new Map<string, Promise<Preview | null>>());
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const volume = usePlayer((s) => s.volume);
  const playerPlaying = usePlayer((s) => s.playing);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    seq.current++; // a preview still resolving its source must not start after this
    map.current.forEach((p) => void p.then((v) => { if (v) void fadeOut(v.el); }));
    setPlaying(null);
  }, []);

  useEffect(() => {
    const m = map.current;
    setReady(new Set()); setPlaying(null);
    if (!key) return;
    let live = true;
    for (const t of tracks) {
      if (!t.file) continue;
      const p = loadPreview(t.file, usePlayer.getState().volume);
      m.set(t.id, p);
      void p.then((v) => { if (v && live) setReady((r) => new Set(r).add(t.id)); });
    }
    return () => { live = false; clearTimeout(timer.current); seq.current++; m.forEach((p) => void p.then(release)); m.clear(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { map.current.forEach((p) => void p.then((v) => { if (v) v.el.volume = volume; })); }, [volume]);
  useEffect(() => { if (playerPlaying) stop(); }, [playerPlaying, stop]);

  /** play this track's preview, or stop it if it is the one playing */
  const toggle = useCallback((t: Track) => {
    if (playing === t.id) { stop(); return; }
    const loading = map.current.get(t.id);
    if (!t.file || !loading) return;
    stop();
    usePlayer.getState().pause();
    setPlaying(t.id);
    const mine = ++seq.current;
    void loading.then((p) => {
      if (!p || mine !== seq.current) return;
      p.el.volume = usePlayer.getState().volume;
      p.el.currentTime = middle(p.el);
      void p.el.play();
      timer.current = setTimeout(stop, SNIPPET_MS);
    });
  }, [playing, stop]);

  return { ready, playing, toggle, stop };
}
export type PreviewState = ReturnType<typeof usePreviews>;
