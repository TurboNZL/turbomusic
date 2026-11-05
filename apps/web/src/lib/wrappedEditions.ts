import type { Motif } from '../components/AbstractArt.tsx';

/**
 * Spotify's Wrapped has changed every year, so each year here gets the screens that edition had, as far as TurboMusic has the data for
 * them, in Spotify's order, in colours in the spirit of that year. Screens Spotify showed that need data TurboMusic does not have
 * (Audio Aura moods, Sound Town cities, podcasts, fan rankings) are left out. This is a re-creation from public descriptions of each
 * year's Wrapped, not a copy: the colours and the order are approximate.
 */
export type SlideId =
  | 'intro' | 'minutes' | 'quiz' | 'songs' | 'topartist' | 'artists' | 'albums' | 'genres' | 'age' | 'phases' | 'race' | 'day' | 'marathon'
  | 'decades' | 'numbers' | 'days' | 'reactions' | 'personality' | 'summary';

export interface Edition {
  year: number;
  /** what the experience was called */
  name: string;
  /** the screens, in order */
  slides: SlideId[];
  /** background gradients, cycled per slide */
  palette: string[];
  /** a motif per slide kind can be overridden; the rest follow the default table */
  motifs?: Partial<Record<SlideId, Motif>>;
  /** one line saying what this edition was known for */
  blurb: string;
}

const g = (a: string, b: string, c?: string) => `linear-gradient(135deg, ${a} 0%, ${b} ${c ? '55%' : '100%'}${c ? `, ${c} 100%` : ''})`;

const EDITIONS: Record<number, Omit<Edition, 'year'>> = {
  2016: {
    name: 'Wrapped', blurb: 'The first Wrapped: how long you listened, your top artists and songs, your genres, and a quiz about your own taste.',
    slides: ['intro', 'minutes', 'quiz', 'topartist', 'artists', 'songs', 'genres', 'summary'],
    palette: [g('#1db954', '#0b3d1f'), g('#1ed760', '#093a1d'), g('#169c46', '#06260f')],
  },
  2017: {
    name: 'Wrapped', blurb: 'Your top artists, your top songs and the minutes behind them, with a playlist of the year.',
    slides: ['intro', 'minutes', 'artists', 'songs', 'genres', 'summary'],
    palette: [g('#6a1b9a', '#1a0b2e'), g('#e91e63', '#310c24'), g('#3949ab', '#0f1740'), g('#ff8f00', '#4a2300')],
  },
  2018: {
    name: 'Wrapped', blurb: 'Bold two-tone screens: your top artist, top songs, genres and total minutes.',
    slides: ['intro', 'minutes', 'topartist', 'artists', 'songs', 'genres', 'summary'],
    palette: [g('#ff4081', '#4a148c'), g('#00bcd4', '#1a237e'), g('#ffab00', '#bf360c'), g('#7c4dff', '#311b92')],
  },
  2019: {
    name: 'Wrapped · decade edition', blurb: 'Your year and the decade: top artists, songs, genres and minutes, looking back across the 2010s.',
    slides: ['intro', 'minutes', 'artists', 'songs', 'genres', 'decades', 'summary'],
    palette: [g('#5b2bd6', '#150a3a'), g('#d62b8f', '#2d0a3f'), g('#1d6ee8', '#0a1a4f'), g('#12b886', '#06352a')],
  },
  2020: {
    name: 'Wrapped', blurb: 'Quizzes and big colour blocks: a guess at your top song, your top artists, songs and genres.',
    slides: ['intro', 'minutes', 'quiz', 'songs', 'artists', 'genres', 'numbers', 'summary'],
    palette: [g('#a4c639', '#2b3a0c'), g('#ff6f91', '#52122b'), g('#845ec2', '#241247'), g('#ff9671', '#5a2312')],
  },
  2021: {
    name: 'Wrapped', blurb: 'Your top songs and artists, and the Audio Aura moods (TurboMusic has no mood data, so the aura screen is left out).',
    slides: ['intro', 'minutes', 'quiz', 'songs', 'artists', 'albums', 'genres', 'summary'],
    palette: [g('#ff7e5f', '#4a1230', '#feb47b'), g('#654ea3', '#1a1042', '#eaafc8'), g('#11998e', '#0b2f4a', '#38ef7d'), g('#fc466b', '#2a1060', '#3f5efb')],
  },
  2022: {
    name: 'Wrapped', blurb: 'Listening Personality and Audio Day: who you are as a listener and how your day sounded.',
    slides: ['intro', 'minutes', 'songs', 'artists', 'genres', 'day', 'personality', 'summary'],
    palette: [g('#f7a8c8', '#5a2a7a'), g('#9be3c0', '#1d4d57'), g('#ffd36e', '#7a3b2e'), g('#a0b4ff', '#32307a')],
  },
  2023: {
    name: 'Wrapped', blurb: 'Neon screens: your listening character, top songs and artists, and your standout days (Sound Town cities need data TurboMusic lacks).',
    slides: ['intro', 'minutes', 'songs', 'artists', 'albums', 'genres', 'personality', 'marathon', 'summary'],
    palette: [g('#ff2e93', '#2a0a5e'), g('#00f5a0', '#06304a'), g('#ffe53b', '#7a1d63'), g('#3d5afe', '#12063a')],
  },
  2024: {
    name: 'Wrapped', blurb: 'Music Evolution (your year in phases), your streaks, top songs and artists and a listening character.',
    slides: ['intro', 'minutes', 'songs', 'artists', 'genres', 'phases', 'days', 'personality', 'summary'],
    palette: [g('#ff6b35', '#43123a'), g('#1fd1c4', '#0b2a4a'), g('#ff5ea8', '#3a0f57'), g('#c8e64c', '#17402c')],
  },
  2025: {
    name: 'Wrapped', blurb: 'The newest edition: everything above in one, with a quiz, listening age, the top artist race and more.',
    slides: ['intro', 'minutes', 'quiz', 'songs', 'artists', 'albums', 'genres', 'age', 'phases', 'race', 'day', 'marathon', 'decades', 'numbers', 'days', 'reactions', 'personality', 'summary'],
    palette: [g('#7c3aed', '#312e81'), g('#db2777', '#7c2d12'), g('#0891b2', '#1e3a8a'), g('#16a34a', '#064e3b'), g('#ea580c', '#7f1d1d'), g('#9333ea', '#be185d'), g('#2563eb', '#4c1d95')],
  },
};

const FUTURE = EDITIONS[2025];
const FIRST_YEAR = 2016;

/** The edition for a year: before 2016 there was only the plain "Year in Music", after the last known one the newest format carries on. */
export function editionFor(year: number): Edition {
  if (year >= FIRST_YEAR) return { year, ...(EDITIONS[year] ?? FUTURE) };
  return { year, name: 'Year in Music', blurb: 'Before Wrapped there was a simple year in review: your top artists and songs.', slides: ['intro', 'minutes', 'artists', 'songs', 'summary'], palette: [g('#1db954', '#0b3d1f'), g('#191414', '#1db954')] };
}

export const EDITION_YEARS = Object.keys(EDITIONS).map(Number);
