import { Link } from 'react-router-dom';
import type { Lead } from '../lib/library.ts';

/** Every lead artist as its own link ("A, B"), so each can be clicked on its own. Featured artists follow ("A feat. X, Y") the same way. */
export function ArtistLinks({ leads, featured = [], className = 'hover:text-fg hover:underline', plain = false }: { leads: Lead[]; featured?: Lead[]; className?: string; /** names only, no links (cards that open a menu on right-click instead) */ plain?: boolean }) {
  if (!leads.length && !featured.length) return <>Unknown artist</>;
  const link = (l: Lead) => plain ? <>{l.name}</> : <Link to={`/artists/${l.id}`} className={className} onClick={(e) => e.stopPropagation()}>{l.name}</Link>;
  return <>
    {leads.map((l, i) => <span key={l.id}>{i > 0 && ', '}{link(l)}</span>)}
    {featured.length > 0 && <>{leads.length > 0 && ' feat. '}{featured.map((l, i) => <span key={l.id}>{i > 0 && ', '}{link(l)}</span>)}</>}
  </>;
}
