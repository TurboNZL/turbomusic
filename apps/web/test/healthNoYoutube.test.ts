import { describe, expect, it } from 'vitest';
import { computeHealth } from '../src/lib/health.ts';
import type { Library } from '../src/lib/library.ts';

const lib = (over: object) => ({ tracks: [], albums: [], artists: [], groups: [], genres: [], roles: [], releases: [], noteCategories: [], logs: [], votes: [], profile: null, trackById: new Map(), singles: [], eras: [], playlists: [], timeline: [], releaseNames: [], legacyNotes: [], memoryLogs: [], rules: [], ...over }) as unknown as Library;
const track = (id: string, albumId: string | null, extra = {}) => ({ leads: [], featured: [], allGenres: [], id, title: id, artistName: 'A', artistId: 'a1', credits: [], storedCredits: [], genres: [], albumId, youtubeMusicUrl: null, file: null, ...extra });

describe('health: YouTube links and artists', () => {
  it('moves albums marked as not on YouTube Music to their own list', () => {
    const l = lib({ tracks: [track('t1', 'al1'), track('t2', 'al2'), track('t3', null)], albums: [{ id: 'al1', title: 'One', artistName: 'A', credits: [], genres: [], trackIds: ['t1'], noYoutube: true }, { id: 'al2', title: 'Two', artistName: 'A', credits: [], genres: [], trackIds: ['t2'] }] });
    const h = computeHealth(l);
    expect(h.find((c) => c.id === 'no-youtube')!.items.map((i) => i.id).sort()).toEqual(['t2', 't3']);
    expect(h.find((c) => c.id === 'no-youtube-album')!.items.map((i) => i.id)).toEqual(['al1']);
  });
  it('counts an artist credited only on a track that follows its album', () => {
    const l = lib({ artists: [{ id: 'p1', name: 'Producer' }, { id: 'x', name: 'Nobody' }], tracks: [track('t1', 'al1', { storedCredits: [{ artistId: 'p1', role: ['Producer'] }] })], albums: [{ id: 'al1', title: 'One', artistName: 'A', credits: [], genres: [], trackIds: ['t1'] }] });
    expect(computeHealth(l).find((c) => c.id === 'artist-unused')!.items.map((i) => i.id)).toEqual(['x']);
  });
});
