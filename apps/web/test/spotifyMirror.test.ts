import { describe, expect, it } from 'vitest';
import { mirrorWanted, type MirrorInput } from '../src/lib/spotifyMirrorPure.ts';

const base: MirrorInput = { enabled: true, engine: 'web', playing: true, loading: false, hasFile: true, uri: 'spotify:track:abc', signedIn: true, silent: true };
describe('spotify mirror', () => {
  it('mirrors a playing file track that has a Spotify link', () => expect(mirrorWanted(base)).toBe(true));
  it.each([
    ['off', { enabled: false }], ['paused', { playing: false }], ['loading', { loading: true }], ['no file (Spotify plays it for real)', { hasFile: false }],
    ['Spotify engine active', { engine: 'spotify' as const }], ['no Spotify link', { uri: null }], ['signed out', { signedIn: false }],
    ['device would be audible', { silent: false }],
  ])('does not mirror when %s', (_n, o) => expect(mirrorWanted({ ...base, ...o })).toBe(false));
});
