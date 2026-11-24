import { Eye, EyeOff } from 'lucide-react';
import { useStore } from '../lib/store.ts';

/** The same Hide / Show button on an album's and an artist's page: hidden ones leave the lists (and come back with the list's own "Hidden" switch). */
export function HideButton({ table, id, noun }: { table: 'albums' | 'artists'; id: string; noun: string }) {
  const hidden = useStore((s) => !!(s.rows[table].get(id)?.data as { hidden?: boolean } | undefined)?.hidden);
  const patch = useStore((s) => s.patch);
  return (
    <button type="button" className={`btn ${hidden ? 'btn-accent' : 'btn-ghost'}`} aria-pressed={hidden} title={hidden ? `This ${noun} is hidden from the lists: press to show it again` : `Hide this ${noun} from the lists`} onClick={() => patch(table, id, { hidden: !hidden })}>
      {hidden ? <Eye size={15} /> : <EyeOff size={15} />}{hidden ? 'Hidden' : 'Hide'}
    </button>
  );
}
