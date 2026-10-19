import { z } from 'zod';

/**
 * Every synced row is a generic record. Clients keep typed views; the server only needs
 * (table, id, updatedAt, deleted, data) to merge. Conflict rule: highest updatedAt wins,
 * ties broken by deviceId, so every peer converges to the same state.
 */
export const RECORD_TABLES = [
  'artists', 'eras', 'albums', 'releases', 'tracks', 'playlists', 'groups',
  'genres', 'roleCategories', 'timeline', 'votes', 'playbackLogs', 'profiles', 'notes', 'noteCategories', 'releaseNames', 'memoryLogs',
] as const;
export type RecordTable = (typeof RECORD_TABLES)[number];

/** Append-only tables never conflict: each row is written once. */
export const APPEND_ONLY: ReadonlySet<RecordTable> = new Set(['votes', 'playbackLogs', 'timeline']);

export const recordSchema = z.object({
  table: z.enum(RECORD_TABLES),
  id: z.string().min(1).max(64),
  updatedAt: z.number().int().nonnegative(),
  deviceId: z.string().max(64).default(''),
  deleted: z.boolean().default(false),
  data: z.record(z.unknown()).default({}),
});
export type SyncRecord = z.infer<typeof recordSchema>;

export const pushSchema = z.object({ records: z.array(recordSchema).max(5000) });
export type PushRequest = z.infer<typeof pushSchema>;

export interface PullResponse {
  records: (SyncRecord & { seq: number })[];
  /** pass back as ?since= on the next pull */
  cursor: number;
  more: boolean;
}

/** true if `incoming` should replace `existing` */
export function wins(
  incoming: Pick<SyncRecord, 'updatedAt' | 'deviceId'>,
  existing: Pick<SyncRecord, 'updatedAt' | 'deviceId'> | undefined,
): boolean {
  if (!existing) return true;
  if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
  return incoming.deviceId > existing.deviceId;
}

export const sha256Hex = /^[0-9a-f]{64}$/;
