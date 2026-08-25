import {
  orderQueue,
  queueProgress,
  type ReviewableRecord,
  type VoteTally,
} from '@/utils/reviewQueue';

const rec = (
  id: string,
  position = 'closed-guard-bottom',
  flags: Partial<ReviewableRecord> = {},
): ReviewableRecord => ({
  id,
  position,
  prescription: `p-${id}`,
  why: '',
  detail: '',
  counter: '',
  gi: 'either',
  level: 'any',
  opponent: null,
  certified: false,
  contested: false,
  rejected: false,
  ...flags,
});

const tally = (entries: [string, VoteTally][]) => new Map(entries);

describe('orderQueue (#77)', () => {
  it('puts a record one vote from settling ahead of an untouched one', () => {
    // One more review settles it; an untouched record needs two. Finishing
    // what someone started is roughly twice the settled records per review.
    const q = orderQueue(
      [rec('a'), rec('b')],
      tally([['b', { certify: 1, reject: 0 }]]),
      new Set(),
    );
    expect(q.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('hides records this reviewer already voted on', () => {
    const q = orderQueue([rec('a'), rec('b')], tally([]), new Set(['a']));
    expect(q.map((r) => r.id)).toEqual(['b']);
  });

  it('drops records already settled by others', () => {
    const q = orderQueue(
      [
        rec('a', 'p', { certified: true }),
        rec('b', 'p', { rejected: true }),
        rec('c'),
      ],
      tally([]),
      new Set(),
    );
    expect(q.map((r) => r.id)).toEqual(['c']);
  });

  it('KEEPS contested records — disagreement is what needs a third opinion', () => {
    const q = orderQueue(
      [rec('a', 'p', { contested: true })],
      tally([['a', { certify: 1, reject: 1 }]]),
      new Set(),
    );
    expect(q.map((r) => r.id)).toEqual(['a']);
  });

  it('groups by position so the reviewer is not thrown between contexts', () => {
    const q = orderQueue(
      [
        rec('a', 'mount-bottom'),
        rec('b', 'closed-guard-bottom'),
        rec('c', 'mount-bottom'),
      ],
      tally([]),
      new Set(),
      ['closed-guard-bottom', 'mount-bottom'],
    );
    expect(q.map((r) => r.position)).toEqual([
      'closed-guard-bottom',
      'mount-bottom',
      'mount-bottom',
    ]);
  });

  it('is deterministic for the same inputs', () => {
    const input = [rec('b'), rec('a'), rec('c')];
    const once = orderQueue(input, tally([]), new Set()).map((r) => r.id);
    const twice = orderQueue(input, tally([]), new Set()).map((r) => r.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(['a', 'b', 'c']);
  });
});

describe('queueProgress', () => {
  it('reports settled, contested and remaining against the whole corpus', () => {
    const records = [
      rec('a', 'p', { certified: true }),
      rec('b', 'p', { rejected: true }),
      rec('c', 'p', { contested: true }),
      rec('d'),
    ];
    const queue = orderQueue(records, tally([]), new Set());
    expect(queueProgress(records, queue)).toEqual({
      settled: 2,
      contested: 1,
      remaining: 2,
      total: 4,
    });
  });
});

describe('skipping (#77 follow-up)', () => {
  it('removes a skipped record from this sitting', () => {
    const q = orderQueue(
      [rec('a'), rec('b')],
      tally([]),
      new Set(),
      [],
      new Set(['a']),
    );
    expect(q.map((r) => r.id)).toEqual(['b']);
  });

  it('does not treat a skip as a vote — the record stays unsettled', () => {
    // A skip is "not me, not now", not a judgement. Nothing about the record's
    // own state may change, or the corpus gains a verdict nobody cast.
    const records = [rec('a')];
    const skippedQueue = orderQueue(
      records,
      tally([]),
      new Set(),
      [],
      new Set(['a']),
    );
    expect(skippedQueue).toHaveLength(0);

    // A fresh sitting (empty skip set) offers it again.
    const laterQueue = orderQueue(records, tally([]), new Set(), [], new Set());
    expect(laterQueue.map((r) => r.id)).toEqual(['a']);
  });

  it('keeps skips separate from this reviewer’s own votes', () => {
    const q = orderQueue(
      [rec('a'), rec('b'), rec('c')],
      tally([]),
      new Set(['a']),
      [],
      new Set(['b']),
    );
    expect(q.map((r) => r.id)).toEqual(['c']);
  });
});
