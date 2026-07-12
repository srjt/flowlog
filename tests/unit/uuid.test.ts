import { generateUuid } from '@/utils/uuid';

const V4_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUuid', () => {
  it('produces v4-shaped uuids', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateUuid()).toMatch(V4_SHAPE);
    }
  });

  it('does not collide across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateUuid());
    expect(seen.size).toBe(1000);
  });

  it('prefers crypto.randomUUID when the runtime provides it', () => {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    const original = g.crypto;
    g.crypto = { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
    try {
      expect(generateUuid()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    } finally {
      if (original === undefined) delete g.crypto;
      else g.crypto = original;
    }
  });
});
