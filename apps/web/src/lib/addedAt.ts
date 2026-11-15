/**
 * When an album was added, for "Latest additions". Sorting by id was wrong: only ids made by newer versions (UUIDv7) start with the time,
 * the older ones are random, so "latest" was a random pick. In order of trust: the journal's "added/imported" entry for the album, the time
 * inside a UUIDv7 id, else 0 (unknown, so it sorts as oldest).
 */
export function uuid7Time(id: string): number {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(id);
  return m ? parseInt(m[1] + m[2], 16) : 0;
}

export function addedTimes(albums: { id: string }[], timeline: { type: string; entityId: string | null; timestamp: number }[]): Map<string, number> {
  const journal = new Map<string, number>();
  for (const e of timeline) if (e.type === 'add' && e.entityId) journal.set(e.entityId, Math.min(journal.get(e.entityId) ?? Infinity, e.timestamp));
  return new Map(albums.map((a) => [a.id, journal.get(a.id) ?? uuid7Time(a.id)]));
}
