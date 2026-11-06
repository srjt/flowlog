import {
  LIVE_COVERAGE_THRESHOLD,
  PARTIAL_PUBLISH_FLAG,
  classifyMappingDrift,
  findLeaks,
  parseContentRangeTotal,
  parsePublishArgs,
  preflight,
  reconcileWithLive,
  scrubNames,
  toServingRecord,
  type ServingRecord,
} from '../../scripts/mining/publish';

const review = {
  id: 'gff-guard-retention-v8-0429',
  position: 'half-guard-bottom',
  prescription: 'Frame on the far hip before he settles his chest.',
  why: 'Once the crossface lands the frame has nowhere to go.',
  detail: 'Forearm across the hip, elbow tight to your own ribs.',
  counter: 'He switches to kesa to attack the framing arm.',
  preconditions: {
    gi: 'either',
    level: 'beginner',
    opponent: 'chest to chest',
  },
  chapter: 'Bridging Escape From Mounted Position (UPA)',
  source: {
    instructor: 'John Danaher',
    instructional: 'GFF Guard Retention',
    volume: 8,
    timestamp: '0:04:29',
    startSeconds: 269,
  },
  quote: 'I never just bridge straight up to the ceiling.',
  certified: false,
  contested: false,
};

describe('toServingRecord', () => {
  it('drops every field that points back to the source', () => {
    const out = toServingRecord(review, 'opaque-id') as unknown as Record<
      string,
      unknown
    >;
    for (const field of ['quote', 'source', 'chapter']) {
      expect(out[field]).toBeUndefined();
    }
  });

  it('uses the supplied opaque id, never the review id', () => {
    // The review id encodes series, volume and timestamp — it IS a citation.
    const out = toServingRecord(review, 'opaque-id');
    expect(out.id).toBe('opaque-id');
    expect(JSON.stringify(out)).not.toContain('gff-guard-retention');
  });

  it('carries review state through — certification must survive a re-publish', () => {
    const certified = { ...review, certified: true, contested: true };
    const out = toServingRecord(certified, 'x');
    expect(out.certified).toBe(true);
    expect(out.contested).toBe(true);
  });

  it('keeps the mechanics intact', () => {
    const out = toServingRecord(review, 'x');
    expect(out.position).toBe('half-guard-bottom');
    expect(out.prescription).toMatch(/far hip/);
    expect(out.why).toMatch(/crossface/);
    expect(out.level).toBe('beginner');
    expect(out.opponent).toBe('chest to chest');
  });
});

describe('scrubNames', () => {
  it('replaces a named training partner with a neutral reference', () => {
    expect(scrubNames('Now when Mateus sits through, my elbow goes low.')).toBe(
      'Now when your opponent sits through, my elbow goes low.',
    );
  });

  it('handles the possessive form', () => {
    expect(scrubNames("Grip Mateus's sleeve at the seam.")).toBe(
      "Grip your opponent's sleeve at the seam.",
    );
  });

  it('catches the recurring mis-transcription of the same name', () => {
    expect(scrubNames('If I bridge, Matace stays where he was.')).not.toMatch(
      /Matace/i,
    );
  });

  it('leaves ordinary text alone', () => {
    const text = 'Point your foot in the direction of the bridge.';
    expect(scrubNames(text)).toBe(text);
  });
});

describe('findLeaks — the backstop the whole boundary rests on', () => {
  const clean: ServingRecord = {
    id: '2f9a1c74-0000-4000-8000-000000000001',
    sportKey: 'bjj',
    position: 'half-guard-bottom',
    prescription: 'Frame on the far hip before he settles his chest.',
    why: 'Once the crossface lands the frame has nowhere to go.',
    detail: 'Forearm across the hip.',
    counter: '',
    gi: 'either',
    level: 'beginner',
    opponent: 'chest to chest',
    certified: false,
    contested: false,
  };

  it('passes a clean record', () => {
    expect(findLeaks([clean])).toEqual([]);
  });

  it('catches an instructor name', () => {
    const bad = {
      ...clean,
      why: 'As Danaher explains, the frame comes first.',
    };
    expect(findLeaks([bad]).map((f) => f.field)).toContain('why');
  });

  it('catches a series name', () => {
    expect(
      findLeaks([{ ...clean, detail: 'See GFF vol 3.' }]).length,
    ).toBeGreaterThan(0);
  });

  it('catches a timestamp, which is a citation in disguise', () => {
    expect(
      findLeaks([{ ...clean, counter: 'shown at 0:04:29' }]).length,
    ).toBeGreaterThan(0);
  });

  it('catches a volume reference', () => {
    expect(
      findLeaks([{ ...clean, why: 'covered in Volume 4' }]).length,
    ).toBeGreaterThan(0);
  });

  it('catches a source id that leaked into the id field', () => {
    const bad = { ...clean, id: 'gff-guard-retention-v8-0429' };
    expect(findLeaks([bad]).map((f) => f.field)).toContain('id');
  });

  it('catches a dropped field being present at all', () => {
    const bad = {
      ...clean,
      quote: 'I never just bridge straight up.',
    } as ServingRecord;
    expect(findLeaks([bad]).map((f) => f.marker)).toContain(
      'field must not be present',
    );
  });

  it('reports enough to find the leak — field, marker and an excerpt', () => {
    const [finding] = findLeaks([{ ...clean, why: 'As Danaher explains it.' }]);
    expect(finding?.field).toBe('why');
    expect(finding?.excerpt).toMatch(/Danaher/);
  });
});

describe('findLeaks — clock directions are mechanics, not citations', () => {
  const base: ServingRecord = {
    id: '2f9a1c74-0000-4000-8000-000000000002',
    sportKey: 'bjj',
    position: 'closed-guard-bottom',
    prescription: 'Drive their base toward the 10:30 direction.',
    why: '',
    detail: 'Push in that 10:30 or 11 o’clock direction.',
    counter: '',
    gi: 'either',
    level: 'any',
    opponent: '',
    certified: false,
    contested: false,
  };

  it('does not flag a clock-face angle', () => {
    // Grapplers describe angles this way constantly; blocking it would reject
    // legitimate mechanics. Found against the real 953-record corpus.
    expect(findLeaks([base])).toEqual([]);
  });

  it('still flags a real source timestamp', () => {
    expect(
      findLeaks([{ ...base, detail: 'shown at 0:04:29' }]).length,
    ).toBeGreaterThan(0);
  });
});

// ── #131: reconciling a publish with the live serving store ───────────────

const ids = (n: number, prefix = 'serving') =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

const servingRecord = (id: string): ServingRecord => ({
  id,
  sportKey: 'bjj',
  position: 'half-guard-bottom',
  prescription: 'Frame on the far hip before he settles his chest.',
  why: 'Once the crossface lands the frame has nowhere to go.',
  detail: '',
  counter: '',
  gi: 'either',
  level: 'any',
  opponent: '',
  certified: false,
  contested: false,
});

describe('reconcileWithLive — does this publish account for the live store?', () => {
  it('refuses the stale store over the live one', () => {
    // The case #131 exists for: 1,874 records, 1,637 of them already mapped,
    // upserted over a 5,574-record live store.
    const all = ids(1874);
    const d = reconcileWithLive({
      servingIds: all,
      mintedIds: all.slice(1637),
      liveCount: 5574,
    });
    expect(d.permit).toBe(false);
    expect(d.basis).toBe('refused');
    expect(d.carried).toBe(1637);
    expect(d.liveCount).toBe(5574);
  });

  it('refuses just below the threshold', () => {
    const d = reconcileWithLive({
      servingIds: ids(89),
      liveCount: 100,
      threshold: 0.9,
    });
    expect(d.permit).toBe(false);
  });

  it('permits at and above the threshold', () => {
    expect(
      reconcileWithLive({ servingIds: ids(90), liveCount: 100, threshold: 0.9 })
        .permit,
    ).toBe(true);
    expect(
      reconcileWithLive({ servingIds: ids(100), liveCount: 100 }).permit,
    ).toBe(true);
  });

  it('permits a full re-publish of the canonical store with fresh mining on top', () => {
    const all = ids(5574 + 200);
    const d = reconcileWithLive({
      servingIds: all,
      mintedIds: all.slice(5574),
      liveCount: 5574,
    });
    expect(d.permit).toBe(true);
    expect(d.basis).toBe('covers-live');
  });

  it('permits when the live store is empty — a first publish', () => {
    const all = ids(40);
    const d = reconcileWithLive({
      servingIds: all,
      mintedIds: all,
      liveCount: 0,
    });
    expect(d.permit).toBe(true);
    expect(d.basis).toBe('first-publish');
  });

  it('permits a fragment when a partial publish is declared, and keeps the reason', () => {
    const d = reconcileWithLive({
      servingIds: ids(30),
      liveCount: 5574,
      partialPublishReason: 'probe volume of a new title',
    });
    expect(d.permit).toBe(true);
    expect(d.basis).toBe('partial-publish-declared');
    expect(d.partialPublishReason).toBe('probe volume of a new title');
  });

  it('does not take a blank reason as an override', () => {
    expect(
      reconcileWithLive({
        servingIds: ids(30),
        liveCount: 5574,
        partialPublishReason: '   ',
      }).permit,
    ).toBe(false);
  });

  it('refuses a lost id mapping even when the record count matches', () => {
    // Every id minted fresh: none of them can be live, so this would re-mint
    // every record a reviewer has voted on. Coverage is zero, not 100%.
    const all = ids(5574);
    const d = reconcileWithLive({
      servingIds: all,
      mintedIds: all,
      liveCount: 5574,
    });
    expect(d.permit).toBe(false);
    expect(d.carried).toBe(0);
  });

  it('counts a repeated id once', () => {
    const d = reconcileWithLive({
      servingIds: ['a', 'a', 'b'],
      liveCount: 2,
    });
    expect(d.writes).toBe(2);
  });

  it('will not decide on a live count that is not a count', () => {
    expect(() =>
      reconcileWithLive({ servingIds: [], liveCount: Number.NaN }),
    ).toThrow();
    expect(() =>
      reconcileWithLive({ servingIds: [], liveCount: -1 }),
    ).toThrow();
  });

  it('defaults to a threshold that separates a full re-publish from the stale store', () => {
    expect(LIVE_COVERAGE_THRESHOLD).toBeGreaterThan(1874 / 5574);
    expect(LIVE_COVERAGE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('the partial-publish override is not a leak-check bypass', () => {
  const leaky = {
    ...servingRecord('serving-leaky'),
    why: 'As Danaher explains, the frame comes first.',
  };

  it('sets the override and nothing else', () => {
    // If the override is ever collapsed into a flag that also relaxes another
    // check, it will change more than the reason, and this fails.
    const without = parsePublishArgs(['--dry-run']);
    const withIt = parsePublishArgs([
      '--dry-run',
      PARTIAL_PUBLISH_FLAG,
      'probe volume',
    ]);
    expect(withIt.partialPublishReason).toBe('probe volume');
    expect({ ...withIt, partialPublishReason: null }).toEqual(without);
  });

  it('still refuses a leak when the override is passed on the command line', () => {
    const opts = parsePublishArgs([PARTIAL_PUBLISH_FLAG, 'probe volume']);
    const gate = preflight({
      serving: [leaky],
      liveCount: 5574,
      partialPublishReason: opts.partialPublishReason,
    });
    expect(gate.reconciliation.permit).toBe(true);
    expect(gate.leaks.length).toBeGreaterThan(0);
    expect(gate.ok).toBe(false);
  });
});

describe('preflight — the store guard and the leak check together', () => {
  const leaky = {
    ...servingRecord('serving-leaky'),
    detail: 'See GFF vol 3.',
  };

  it('passes a clean publish that accounts for the live store', () => {
    const gate = preflight({
      serving: ids(10).map(servingRecord),
      liveCount: 10,
    });
    expect(gate.ok).toBe(true);
  });

  it('refuses a clean publish that does not account for the live store', () => {
    const gate = preflight({
      serving: ids(10).map(servingRecord),
      liveCount: 100,
    });
    expect(gate.leaks).toEqual([]);
    expect(gate.ok).toBe(false);
  });

  it('still refuses a leak when the guard is satisfied', () => {
    const gate = preflight({
      serving: [...ids(9).map(servingRecord), leaky],
      liveCount: 10,
    });
    expect(gate.reconciliation.permit).toBe(true);
    expect(gate.ok).toBe(false);
  });

  it('still refuses a leak on a first publish', () => {
    expect(preflight({ serving: [leaky], liveCount: 0 }).ok).toBe(false);
  });

  it('still refuses a leak with the override set', () => {
    const gate = preflight({
      serving: [leaky],
      liveCount: 5574,
      partialPublishReason: 'probe volume',
    });
    expect(gate.reconciliation.basis).toBe('partial-publish-declared');
    expect(gate.leaks.length).toBeGreaterThan(0);
    expect(gate.ok).toBe(false);
  });
});

describe('parsePublishArgs', () => {
  it('requires a reason for a partial publish', () => {
    expect(() => parsePublishArgs([PARTIAL_PUBLISH_FLAG])).toThrow();
    expect(() => parsePublishArgs([PARTIAL_PUBLISH_FLAG, ' '])).toThrow();
    // A following flag is not a reason.
    expect(() =>
      parsePublishArgs([PARTIAL_PUBLISH_FLAG, '--dry-run']),
    ).toThrow();
  });

  it('rejects a flag it does not know rather than ignoring it', () => {
    // An ignored `--dryrun` is a real upload.
    expect(() => parsePublishArgs(['--dryrun'])).toThrow();
  });

  it('reads the flags it does know', () => {
    expect(
      parsePublishArgs([
        '--records',
        '/stores/a',
        '--mapping',
        '/stores/a/m.json',
        '--sql',
        'out.sql',
        '--dry-run',
      ]),
    ).toMatchObject({
      records: '/stores/a',
      mapping: '/stores/a/m.json',
      sql: 'out.sql',
      dryRun: true,
      partialPublishReason: null,
    });
  });
});

describe('classifyMappingDrift', () => {
  it('does not flag a mapping that is short only because of fresh mining', () => {
    const review = ids(5574, 'review');
    const drift = classifyMappingDrift(review.slice(0, 5000), review);
    expect(drift.kind).toBe('unpublished');
    expect(drift.unmapped).toBe(574);
    expect(drift.warn).toBe(false);
  });

  it('does not flag a mapping in step with its store', () => {
    const review = ids(100, 'review');
    expect(classifyMappingDrift(review, review).warn).toBe(false);
  });

  it('flags a mapping that shares no id with its store', () => {
    const drift = classifyMappingDrift(ids(1637, 'gemini'), ids(5574, 'local'));
    expect(drift.kind).toBe('disjoint');
    expect(drift.warn).toBe(true);
  });

  it('does not flag a store that has no mapping yet', () => {
    const drift = classifyMappingDrift([], ids(10, 'review'));
    expect(drift.kind).toBe('none');
    expect(drift.warn).toBe(false);
  });

  it('counts entries that match no record, without flagging them alone', () => {
    const review = ids(100, 'review');
    const drift = classifyMappingDrift(
      [...review, ...ids(20, 'remined')],
      review,
    );
    expect(drift.orphaned).toBe(20);
    expect(drift.warn).toBe(false);
  });
});

describe('parseContentRangeTotal', () => {
  it('reads the exact total PostgREST reports', () => {
    expect(parseContentRangeTotal('0-0/5574')).toBe(5574);
    expect(parseContentRangeTotal('*/0')).toBe(0);
  });

  it('returns null when there is no total, so the guard cannot pass on a guess', () => {
    expect(parseContentRangeTotal(null)).toBeNull();
    expect(parseContentRangeTotal('0-0/*')).toBeNull();
  });
});
