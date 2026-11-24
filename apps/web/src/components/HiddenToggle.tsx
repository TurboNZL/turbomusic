import { Eye, EyeOff } from 'lucide-react';

/**
 * The one "Hidden" switch every list uses (Albums, Artists, Tracks, Singles). What it reveals is everything left out of the list:
 * things you hid yourself and things that are not imported yet (no audio, no YouTube Music link); both count as hidden here.
 */
export function HiddenToggle({ count, on, onChange, noun }: { count: number; on: boolean; onChange: (v: boolean) => void; noun: string }) {
  if (count <= 0) return null;
  return (
    <button type="button" className={`btn ${on ? 'btn-accent' : ''}`} aria-pressed={on}
      title={on ? `Hidden ${noun} are shown: press to leave them out again` : `${count.toLocaleString()} ${noun} you hid or have not imported yet are left out: press to show them`} onClick={() => onChange(!on)}>
      {on ? <Eye size={15} /> : <EyeOff size={15} />}{on ? 'Showing hidden' : 'Hidden'} {count.toLocaleString()}
    </button>
  );
}
