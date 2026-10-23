export interface MirrorInput { enabled: boolean; engine: 'web' | 'native' | 'spotify'; playing: boolean; loading: boolean; hasFile: boolean; uri: string | null; signedIn: boolean | null; silent: boolean }
/** Should the mirror be playing right now? (pure, tested) */
export const mirrorWanted = (i: MirrorInput): boolean => i.enabled && i.signedIn === true && i.silent && i.engine !== 'spotify' && i.playing && !i.loading && i.hasFile && !!i.uri;

