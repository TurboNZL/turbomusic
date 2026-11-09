import type { TimelineData } from '@turbomusic/core';
import { useStore } from './store.ts';

/** Append a journal entry (timeline is append-only on sync, so entries never conflict). */
export function logJournal(type: string, title: string, description = '', entityId: string | null = null, extra: { mood?: string | null } = {}) {
  const data: TimelineData = { type, title, description, entityId, timestamp: Date.now(), ...(extra.mood ? { mood: extra.mood } : {}) };
  return useStore.getState().put('timeline', data);
}
