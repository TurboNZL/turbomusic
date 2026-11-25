/**
 * Which item a menu group does when you press its row (the arrow/flyout still lists them all). Remembered on this device.
 * `GROUP_CHOICES` is what Settings offers; an option matches a menu item whose label starts with it (so "Play next" also matches
 * "Play next (shuffled)").
 */
export const GROUP_CHOICES: { group: string; title: string; options: string[] }[] = [
  { group: 'Queue', title: 'Queue (songs, albums, playlists)', options: ['Add to queue', 'Play next', 'Replace lineup', 'Add to lineup'] },
  { group: 'Import and merge', title: 'Import and merge (albums)', options: ['Import a release from YouTube Music', 'Fix artists from a pasted list', 'Merge with another album'] },
  { group: 'Info, notes and stats', title: 'Info, notes and stats (songs)', options: ['Info', 'Stats page', 'Write a note', 'Rank it against other songs'] },
  { group: 'Edit and organise', title: 'Edit and organise (songs)', options: ['Edit', 'Merge with another track'] },
];
const KEY = 'turbomusic.menuDefaults';

export function readMenuDefaults(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function writeMenuDefault(group: string, option: string | null) {
  const all = readMenuDefaults();
  if (option) all[group] = option; else delete all[group];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private window: not remembered */ }
}
const base = (s: string) => s.replace(/…$/, '').trim().toLowerCase();
/** the index of the item the user chose as the group's default, or -1 */
export function chosenIndex(group: string, labels: string[]): number {
  const want = readMenuDefaults()[group];
  if (!want) return -1;
  return labels.findIndex((l) => base(l).startsWith(base(want)));
}
