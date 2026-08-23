import {
  findLeaks,
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
