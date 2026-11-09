export interface PlaybackRule {
  trackAId: string;
  trackBId: string;
  playFirstOnShuffle: boolean;
  /** only apply when the track was started from an album */
  applyToAlbumSource: boolean;
  /**
   * Crossfade for this A -> B change, in seconds. Missing/null = use the device's crossfade setting, 0 = no crossfade (a plain cut or
   * gapless), a number = fade A out and B in over that long.
   */
  crossfadeSec?: number | null;
  /**
   * Where the fade sits: how many seconds EARLIER than the end of A it finishes (0 = it ends exactly where A ends, the default). A song that
   * ends in silence, or one that starts with silence, needs the next one to come in earlier; the fade is dragged there in the rule's editor.
   * The last seconds of A are then not played. Only used when the change fades at all.
   */
  crossfadeShiftSec?: number | null;
  /**
   * Which sides of the change fade (both default to true). `crossfadeOut: false` = the first song keeps its full volume until it is cut;
   * `crossfadeIn: false` = the second song starts at full volume at once (the first one can still fade out underneath it).
   */
  crossfadeOut?: boolean | null;
  crossfadeIn?: boolean | null;
}

export const MAX_CROSSFADE_SEC = 12;
const clampFade = (n: number) => Math.min(MAX_CROSSFADE_SEC, Math.max(0, n));

/** How long the change from `fromId` to `toId` should crossfade: the rule for that pair if it sets one, else the device's setting. */
export function crossfadeFor(rules: PlaybackRule[], fromId: string, toId: string, deviceSec: number, source?: SourceType): number {
  const rule = ruleFor(rules, fromId, source);
  if (rule && rule.trackBId === toId && typeof rule.crossfadeSec === 'number' && Number.isFinite(rule.crossfadeSec)) return clampFade(rule.crossfadeSec);
  return clampFade(Number.isFinite(deviceSec) ? deviceSec : 0);
}

export const MAX_CROSSFADE_SHIFT_SEC = 12;

/** How much earlier than the end of `fromId` the fade into `toId` is placed (0 unless that pair's rule moves it). */
export function crossfadeShiftFor(rules: PlaybackRule[], fromId: string, toId: string, source?: SourceType): number {
  const rule = ruleFor(rules, fromId, source);
  if (rule && rule.trackBId === toId && typeof rule.crossfadeShiftSec === 'number' && Number.isFinite(rule.crossfadeShiftSec)) return Math.min(MAX_CROSSFADE_SHIFT_SEC, Math.max(0, rule.crossfadeShiftSec));
  return 0;
}

/** Whether the first song fades out and the second fades in for this pair (both true unless the rule turns one off). */
export function crossfadeShapeFor(rules: PlaybackRule[], fromId: string, toId: string, source?: SourceType): { fadeOut: boolean; fadeIn: boolean } {
  const rule = ruleFor(rules, fromId, source);
  if (!rule || rule.trackBId !== toId) return { fadeOut: true, fadeIn: true };
  return { fadeOut: rule.crossfadeOut !== false, fadeIn: rule.crossfadeIn !== false };
}

export type SourceType = 'album' | 'playlist' | 'track' | 'shuffle' | 'search';

export interface QueueState {
  /** manually queued ("play next") */
  user: string[];
  /** remainder of the album/playlist being played */
  active: string[];
  currentId: string | null;
}

/** Does a "play B after A" rule fire for this track + source? */
export function ruleFor(rules: PlaybackRule[], trackId: string, source?: SourceType): PlaybackRule | undefined {
  const rule = rules.find((r) => r.trackAId === trackId);
  if (!rule) return undefined;
  return rule.applyToAlbumSource && source !== 'album' ? undefined : rule;
}

/** Start playing `trackId` out of an ordered list; rules may inject B at the front of the user queue. */
export function startTrack(
  state: QueueState,
  trackId: string,
  list: string[],
  rules: PlaybackRule[],
  source?: SourceType,
): QueueState {
  const idx = list.indexOf(trackId);
  const active = idx === -1 ? [] : list.slice(idx + 1);
  const user = [...state.user];
  const rule = ruleFor(rules, trackId, source);
  if (rule && user[0] !== rule.trackBId && active[0] !== rule.trackBId) user.unshift(rule.trackBId);
  return { currentId: trackId, active, user };
}

/** Advance: user queue first, then the active list. Rules were already injected by startTrack/advance. */
export function advance(state: QueueState, rules: PlaybackRule[], source?: SourceType): QueueState {
  let { user, active } = state;
  let next: string | undefined;
  if (user.length) [next, ...user] = user;
  else if (active.length) [next, ...active] = active;
  if (!next) return { currentId: null, user, active };
  const rule = ruleFor(rules, next, source);
  if (rule && user[0] !== rule.trackBId && active[0] !== rule.trackBId) user = [rule.trackBId, ...user];
  return { currentId: next, user, active };
}

/** Fisher-Yates (the old `sort(() => Math.random() - 0.5)` is biased). Honors playFirstOnShuffle rules. */
export function shuffleWithRules(ids: string[], rules: PlaybackRule[], rnd: () => number = Math.random): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  for (const r of rules.filter((x) => x.playFirstOnShuffle)) {
    const a = out.indexOf(r.trackAId);
    const b = out.indexOf(r.trackBId);
    if (a === -1 || b === -1) continue;
    out.splice(b, 1);
    out.splice(out.indexOf(r.trackAId) + 1, 0, r.trackBId); // recompute A: removing B may shift it
  }
  return out;
}

/** Previous-track history, so "back" works (the old store had an empty previousTrack). */
export function pushHistory(history: string[], id: string | null, max = 100): string[] {
  return id ? [...history, id].slice(-max) : history;
}
