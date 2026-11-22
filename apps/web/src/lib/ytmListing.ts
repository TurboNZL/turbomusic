import { splitFeaturing } from './autofill.ts';

/** One song of a YouTube Music album page, copied as text. */
export interface ListedTrack { title: string; leads: string[]; featured: string[]; plays: string | null; duration: string | null }

const SEPARATOR = /^[,&•·+]$/;
const PLAYS = /\bplays?$/i;
const DURATION = /^\d{1,2}:\d{2}$/;

/**
 * Reads the text you get by selecting an album's track list on YouTube Music and copying it: per song a number, the title, one line
 * per artist (separators like "," and "&" on lines of their own), "110K plays" and the length. The first number and any blank lines
 * may be missing. "(feat. X)" in a title becomes featured artists; the artist lines are the song's lead artists.
 */
export function parseYtmListing(text: string): ListedTrack[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ListedTrack[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\d{1,3}$/.test(lines[i]) && i + 1 < lines.length) i++; // the row number
    const raw = lines[i++];
    if (raw === undefined) break;
    const artists: string[] = [];
    let plays: string | null = null, duration: string | null = null;
    while (i < lines.length) {
      const l = lines[i];
      if (PLAYS.test(l)) { plays = l; i++; continue; }
      if (DURATION.test(l)) { duration = l; i++; break; }
      // a number that starts the next row (the last song has no duration line when the copy was cut)
      if (/^\d{1,3}$/.test(l) && plays) break;
      if (!SEPARATOR.test(l)) artists.push(l);
      i++;
    }
    const sp = splitFeaturing(raw);
    if (artists.length || plays || duration) out.push({ title: sp.title, leads: [...new Set(artists)], featured: sp.featured, plays, duration });
  }
  return out;
}
