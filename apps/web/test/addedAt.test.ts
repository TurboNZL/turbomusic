import { describe, expect, it } from 'vitest';
import { addedTimes, uuid7Time } from '../src/lib/addedAt.ts';

describe('album added time', () => {
  it('reads the time of a UUIDv7 and nothing from a random id', () => {
    expect(uuid7Time('0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b')).toBe(parseInt('0192a3b4c5d6', 16));
    expect(uuid7Time('k3j2h1g')).toBe(0);
    expect(uuid7Time('4f9c2a10-1111-4222-8333-444455556666')).toBe(0); // a v4 id has no time
  });
  it('prefers the journal entry over the id', () => {
    const t = addedTimes([{ id: 'a' }, { id: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b' }], [{ type: 'add', entityId: 'a', timestamp: 500 }, { type: 'edit', entityId: 'a', timestamp: 9 }]);
    expect(t.get('a')).toBe(500);
    expect(t.get('0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b')).toBeGreaterThan(0);
  });
});
