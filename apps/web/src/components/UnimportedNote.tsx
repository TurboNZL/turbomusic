import { Eye } from 'lucide-react';
import { getLibrary } from '../lib/derive.ts';
import { useStore } from '../lib/store.ts';
import { unimportedOf } from '../lib/unimported.ts';

/** "N albums are hidden because they are not imported yet": says why a list is shorter than expected and turns them on. Nothing shows while the setting is on or there is nothing hidden. */
export function UnimportedNote({ kind }: { kind: 'albums' | 'artists' | 'tracks' }) {
  const show = useStore((s) => s.settings.showUnimported);
  const rev = useStore((s) => s.rev);
  const update = useStore((s) => s.updateSettings);
  if (show) return null;
  void rev;
  const u = unimportedOf(getLibrary());
  const n = u[kind].size;
  if (!n) return null;
  return <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{n.toLocaleString()} {kind === 'tracks' ? (n === 1 ? 'song' : 'songs') : kind === 'albums' ? (n === 1 ? 'album' : 'albums') : (n === 1 ? 'artist' : 'artists')} not imported yet {n === 1 ? 'is' : 'are'} hidden.</span>
    <button type="button" className="btn btn-ghost !py-0.5 text-xs" onClick={() => update({ showUnimported: true })}><Eye size={13} />Show {n === 1 ? 'it' : 'them'}</button></p>;
}
