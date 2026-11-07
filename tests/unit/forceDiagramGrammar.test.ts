import {
  GRAMMAR_VERSION,
  MAX_ANNOTATIONS,
  PRIMITIVES,
  PRIMITIVE_NAMES,
  SPEC_VERSION,
  describeGrammar,
} from '@/visualization/grammar';
import { validateSpec } from '@/visualization/validateSpec';
import {
  REFERENCE_CASES,
  referenceSpec,
  seedBase,
} from '../fixtures/forceDiagram/seeds';

const dlr = seedBase('de-la-riva');

/** A DLR spec with the given annotations. */
const spec = (...annotations: unknown[]) => ({
  specVersion: SPEC_VERSION,
  base: 'de-la-riva',
  annotations,
});

function errorsOf(input: unknown, base = dlr): string {
  const v = validateSpec(input, base);
  expect(v.ok).toBe(false);
  return v.ok ? '' : v.errors.join('\n');
}

describe('the grammar', () => {
  it('is versioned', () => {
    expect(GRAMMAR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the closed set of nine primitives', () => {
    expect([...PRIMITIVE_NAMES].sort()).toEqual(
      [
        'base',
        'counter',
        'force',
        'frame',
        'grip',
        'movement-path',
        'pressure',
        'rotation',
        'weight-distribution',
      ].sort(),
    );
    expect(Object.keys(PRIMITIVES).sort()).toEqual([...PRIMITIVE_NAMES].sort());
  });

  it('only grip takes two anchors', () => {
    for (const name of PRIMITIVE_NAMES)
      expect(PRIMITIVES[name].arity).toBe(name === 'grip' ? 2 : 1);
  });

  it('describes every primitive to the model', () => {
    const text = describeGrammar();
    for (const name of PRIMITIVE_NAMES) expect(text).toContain(`- ${name}:`);
  });
});

describe('validateSpec — accepts', () => {
  it.each(REFERENCE_CASES)(
    "the prototype's golden spec $baseId / $cueId",
    ({ baseId, cueId }) => {
      const v = validateSpec(referenceSpec(baseId, cueId), seedBase(baseId));
      if (!v.ok) throw new Error(v.errors.join('; '));
      expect(v.spec.annotations).toHaveLength(
        referenceSpec(baseId, cueId).annotations.length,
      );
      expect(v.warnings).toEqual([]);
    },
  );

  it('the #135 example spec, unchanged', () => {
    const example = spec(
      {
        type: 'force',
        anchor: 'hook_heel',
        relation: { toward: 'opp_hamstring' },
        intensity: 'high',
      },
      { type: 'pressure', anchor: 'heel_on_hamstring' },
      {
        type: 'counter',
        anchor: 'heel_on_hamstring',
        relation: { toward: 'your_hip' },
      },
      { type: 'base', anchor: 'posting_forearm' },
    );
    const v = validateSpec(example, dlr);
    expect(v.ok && v.spec).toEqual(example);
  });

  it('a frame with or without the optional relation', () => {
    expect(
      validateSpec(spec({ type: 'frame', anchor: 'second_foot' }), dlr).ok,
    ).toBe(true);
    expect(
      validateSpec(
        spec({
          type: 'frame',
          anchor: 'second_foot',
          relation: { away_from: 'opp_hip' },
        }),
        dlr,
      ).ok,
    ).toBe(true);
  });

  it('and normalizes: a one-role array anchor becomes a string, an empty relation is absent, unknown fields are dropped', () => {
    const v = validateSpec(
      {
        ...spec({
          type: 'pressure',
          anchor: ['heel_on_hamstring'],
          relation: {},
          label: 'dig',
        }),
        note: 'model chatter',
      },
      dlr,
    );
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.spec.annotations).toEqual([
      { type: 'pressure', anchor: 'heel_on_hamstring' },
    ]);
    expect(v.spec).not.toHaveProperty('note');
    expect(v.warnings.join('\n')).toMatch(/label[\s\S]*note|note[\s\S]*label/);
  });
});

describe('validateSpec — rejects (the floor)', () => {
  it('an unknown primitive', () => {
    expect(errorsOf(spec({ type: 'squeeze', anchor: 'hook_heel' }))).toContain(
      'unknown primitive "squeeze"',
    );
  });

  it('an inherited object key posing as a primitive, without crashing', () => {
    // The prototype looked primitives up with a bare index and threw here.
    for (const type of ['constructor', '__proto__', 'toString'])
      expect(errorsOf(spec({ type, anchor: 'hook_heel' }))).toContain(
        'unknown primitive',
      );
  });

  it('an unknown role in the anchor', () => {
    expect(errorsOf(spec({ type: 'base', anchor: 'opp_lapel' }))).toContain(
      'unknown role "opp_lapel"',
    );
  });

  it('an unknown role in the relation', () => {
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { toward: 'opp_ankle' },
        }),
      ),
    ).toContain('unknown role "opp_ankle"');
  });

  it("a role from another base (roles are only valid against the spec's own base)", () => {
    // `opp_lapel` exists on closed-guard, not on de-la-riva.
    expect(seedBase('closed-guard').roles).toHaveProperty('opp_lapel');
    expect(
      errorsOf(spec({ type: 'grip', anchor: ['posting_hand', 'opp_lapel'] })),
    ).toContain('unknown role "opp_lapel"');
  });

  it('wrong arity: grip with one anchor, force with two', () => {
    expect(errorsOf(spec({ type: 'grip', anchor: 'posting_hand' }))).toContain(
      'expected 2 anchor role(s), got 1',
    );
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: ['hook_heel', 'second_foot'],
          relation: { toward: 'opp_hip' },
        }),
      ),
    ).toContain('expected 1 anchor role(s), got 2');
    expect(errorsOf(spec({ type: 'base' }))).toContain(
      'expected 1 anchor role(s), got 0',
    );
  });

  it('a missing relation on a primitive that requires one', () => {
    for (const type of ['force', 'counter', 'rotation', 'movement-path'])
      expect(errorsOf(spec({ type, anchor: 'hook_heel' }))).toContain(
        'relation is required',
      );
  });

  it('an illegal relation kind for the primitive', () => {
    expect(
      errorsOf(
        spec({
          type: 'rotation',
          anchor: 'your_shoulder',
          relation: { toward: 'hook_heel' },
        }),
      ),
    ).toContain('relation "toward" not allowed (allowed: around)');
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { around: 'opp_hip' },
        }),
      ),
    ).toContain('relation "around" not allowed');
  });

  it('a relation on a primitive that takes none', () => {
    expect(
      errorsOf(
        spec({
          type: 'pressure',
          anchor: 'heel_on_hamstring',
          relation: { toward: 'opp_hip' },
        }),
      ),
    ).toContain('takes no relation');
  });

  it('a relation naming more than one direction, or an unknown one', () => {
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { toward: 'opp_hip', away_from: 'opp_hip' },
        }),
      ),
    ).toContain('exactly one of');
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { into: 'opp_hip' },
        }),
      ),
    ).toContain('unknown relation "into"');
  });

  it('a direction with no angle: the relation names the anchor itself', () => {
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { toward: 'hook_heel' },
        }),
      ),
    ).toContain('no direction to draw');
  });

  it('a direction between two roles that resolve to the same point', () => {
    // On closed-guard, opp_waist and opp_hip are both aliases of opp.hip.
    const cg = seedBase('closed-guard');
    expect(
      errorsOf(
        {
          specVersion: 1,
          base: 'closed-guard',
          annotations: [
            {
              type: 'force',
              anchor: 'opp_waist',
              relation: { toward: 'opp_hip' },
            },
          ],
        },
        cg,
      ),
    ).toContain('no direction to draw');
  });

  it('a grip from a point to itself', () => {
    expect(
      errorsOf(
        spec({ type: 'grip', anchor: ['posting_hand', 'posting_hand'] }),
      ),
    ).toContain('same point');
  });

  it('an invalid intensity', () => {
    expect(
      errorsOf(
        spec({
          type: 'force',
          anchor: 'hook_heel',
          relation: { toward: 'opp_hip' },
          intensity: 'max',
        }),
      ),
    ).toContain('invalid intensity "max"');
  });

  it('a spec for a different base', () => {
    expect(
      errorsOf({
        ...referenceSpec('de-la-riva', 'heel-hamstring'),
        base: 'closed-guard',
      }),
    ).toContain('spec is for base "closed-guard", not "de-la-riva"');
  });

  it('another spec version', () => {
    expect(
      errorsOf({
        ...referenceSpec('de-la-riva', 'heel-hamstring'),
        specVersion: 2,
      }),
    ).toContain('specVersion must be 1');
  });

  it('the whole spec when any one annotation is bad', () => {
    // Drawing only the good half of a mechanic can mislead more than no picture.
    const v = validateSpec(
      spec(
        { type: 'base', anchor: 'posting_forearm' },
        { type: 'base', anchor: 'nowhere' },
      ),
      dlr,
    );
    expect(v.ok).toBe(false);
  });
});

describe('validateSpec — empty or unusable input means no diagram, never a throw', () => {
  it('an empty spec yields no diagram', () => {
    expect(errorsOf(spec())).toContain('nothing to draw');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"specVersion":1}'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
    [
      'annotations that are not a list',
      { specVersion: 1, base: 'de-la-riva', annotations: 'force' },
    ],
    ['annotations that are not objects', spec(null, 3, 'force')],
  ])('%s', (_label, input) => {
    expect(() => validateSpec(input, dlr)).not.toThrow();
    expect(validateSpec(input, dlr).ok).toBe(false);
  });

  it('a hostile object', () => {
    const hostile = Object.defineProperty({}, 'annotations', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    expect(() => validateSpec(hostile, dlr)).not.toThrow();
    expect(validateSpec(hostile, dlr).ok).toBe(false);
  });

  it('a broken base is reported, not thrown', () => {
    const broken = { ...dlr, roles: { hook_heel: { joint: 'you.missing' } } };
    expect(
      errorsOf(referenceSpec('de-la-riva', 'heel-hamstring'), broken),
    ).toContain('base:');
  });
});

describe('validateSpec — the soft cap', () => {
  const six = [
    {
      type: 'force',
      anchor: 'hook_heel',
      relation: { toward: 'opp_hamstring' },
    },
    { type: 'pressure', anchor: 'heel_on_hamstring' },
    {
      type: 'counter',
      anchor: 'heel_on_hamstring',
      relation: { toward: 'your_hip' },
    },
    { type: 'base', anchor: 'posting_forearm' },
    { type: 'base', anchor: 'posting_hand' },
    { type: 'nonsense', anchor: 'nowhere' },
  ];

  it(`keeps the first ${MAX_ANNOTATIONS} annotations, in order, and warns`, () => {
    const v = validateSpec(spec(...six), dlr);
    if (!v.ok) throw new Error(v.errors.join('; '));
    expect(v.spec.annotations).toHaveLength(MAX_ANNOTATIONS);
    expect(v.spec.annotations.map((a) => a.type)).toEqual([
      'force',
      'pressure',
      'counter',
      'base',
    ]);
    expect(v.warnings.join('\n')).toContain('soft cap');
  });

  it('never draws, and so never judges, the truncated tail', () => {
    // The sixth annotation is garbage but sits past the cap.
    expect(validateSpec(spec(...six), dlr).ok).toBe(true);
  });

  it(`does not warn at exactly ${MAX_ANNOTATIONS}`, () => {
    const v = validateSpec(spec(...six.slice(0, MAX_ANNOTATIONS)), dlr);
    expect(v.ok && v.warnings).toEqual([]);
  });
});
