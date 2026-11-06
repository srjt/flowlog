import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_ANNOTATIONS,
  PRIMITIVE_NAMES,
  SPEC_VERSION,
} from '@/visualization/grammar';
import { roleNames } from '@/visualization/keypoints';
import {
  SPEC_PROMPT_VERSION,
  buildSpecPrompt,
  buildSpecSchema,
  parseSpecResponse,
  type JsonSchema,
} from '@/visualization/specStage';
import { referenceSpec, seedBase } from '../fixtures/forceDiagram/seeds';

const dlr = seedBase('de-la-riva');
const CUE =
  'From de la riva, keep your sweeping leg\'s heel digging into the opponent\'s hamstring to prevent their "forward" push.';
const golden = referenceSpec('de-la-riva', 'heel-hamstring');

describe('buildSpecPrompt', () => {
  const prompt = buildSpecPrompt(dlr, CUE);

  it('is versioned', () => {
    expect(SPEC_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("lists exactly the base's roles and every primitive", () => {
    for (const role of roleNames(dlr)) expect(prompt).toContain(`- ${role}\n`);
    for (const name of PRIMITIVE_NAMES) expect(prompt).toContain(`- ${name}:`);
    // A role from another base is never offered.
    expect(prompt).not.toContain('opp_lapel');
  });

  it('carries the cue verbatim and safely quoted', () => {
    expect(prompt).toContain(`CUE: ${JSON.stringify(CUE)}`);
  });

  it('states the cap, the role-relative rule, and the text-only escape hatch', () => {
    expect(prompt).toContain(`At most ${MAX_ANNOTATIONS}`);
    expect(prompt).toContain('Never use angles or coordinates');
    expect(prompt).toContain('empty "annotations" array');
    expect(prompt).not.toMatch(/closest/i); // the prototype's "pick the closest role"
  });

  it('is sport-neutral unless the caller supplies the persona', () => {
    expect(prompt).toMatch(/^You are an expert coach /);
    expect(
      buildSpecPrompt(dlr, CUE, { expert: 'a seasoned instructor' }),
    ).toMatch(/^You are a seasoned instructor /);
  });

  it('is deterministic', () => {
    expect(buildSpecPrompt(dlr, CUE)).toBe(prompt);
  });
});

describe('buildSpecSchema — role enum × grammar enum for one base', () => {
  const schema = buildSpecSchema(dlr);
  const variants = schema.properties!.annotations!.items!.anyOf!;
  const variant = (type: string) =>
    variants.find((v) => v.properties!.type!.enum![0] === type)!;
  // Every slot that names a role: the anchor (or each grip anchor) and the
  // target of every legal relation kind.
  const roleSlots = (v: JsonSchema): JsonSchema[] => {
    const anchor = v.properties!.anchor!;
    const relations = v.properties!.relation?.anyOf ?? [];
    return [
      anchor.items ?? anchor,
      ...relations.flatMap((r) => Object.values(r.properties!)),
    ];
  };

  it('pins the envelope to this base and spec version, under the cap', () => {
    expect(schema.properties!.base!.enum).toEqual(['de-la-riva']);
    expect(schema.properties!.specVersion!.enum).toEqual([SPEC_VERSION]);
    expect(schema.properties!.annotations!.maxItems).toBe(MAX_ANNOTATIONS);
  });

  it('offers one variant per primitive', () => {
    expect(variants.map((v) => v.properties!.type!.enum![0])).toEqual([
      ...PRIMITIVE_NAMES,
    ]);
  });

  it("constrains every role slot to the base's roles", () => {
    const slots = variants.flatMap(roleSlots);
    expect(slots.length).toBeGreaterThan(PRIMITIVE_NAMES.length);
    for (const s of slots)
      expect(s).toEqual({ type: 'string', enum: roleNames(dlr) });
  });

  it('encodes arity: grip takes exactly two roles, everything else one', () => {
    expect(variant('grip').properties!.anchor).toMatchObject({
      type: 'array',
      minItems: 2,
      maxItems: 2,
    });
    expect(variant('force').properties!.anchor!.type).toBe('string');
  });

  it('encodes relation rules per primitive', () => {
    const kinds = (type: string) =>
      variant(type).properties!.relation?.anyOf?.map((o) => o.required![0]);
    expect(kinds('rotation')).toEqual(['around']);
    expect(kinds('force')).toEqual(['toward', 'away_from']);
    expect(kinds('frame')).toEqual(['away_from']);
    expect(variant('pressure').properties!.relation).toBeUndefined();
    expect(variant('force').required).toContain('relation');
    expect(variant('frame').required).not.toContain('relation');
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe('parseSpecResponse — a valid constrained response passes', () => {
  it('as raw text', () => {
    const r = parseSpecResponse(JSON.stringify(golden), dlr);
    expect(r.status).toBe('spec');
    expect(r.status === 'spec' && r.spec).toEqual(golden);
  });

  it('wrapped in a code fence and prose', () => {
    const text = `Here is the spec:\n\`\`\`json\n${JSON.stringify(golden, null, 2)}\n\`\`\`\nDone.`;
    expect(parseSpecResponse(text, dlr).status).toBe('spec');
  });

  it('as an already-parsed object (a tool-use input)', () => {
    expect(parseSpecResponse(golden, dlr).status).toBe('spec');
  });

  it('with the envelope fields omitted, filled from the request', () => {
    const r = parseSpecResponse({ annotations: golden.annotations }, dlr);
    expect(r.status === 'spec' && r.spec.base).toBe('de-la-riva');
    expect(r.status === 'spec' && r.spec.specVersion).toBe(SPEC_VERSION);
  });

  it('truncated to the soft cap, with a warning', () => {
    const long = {
      ...golden,
      annotations: [
        ...golden.annotations,
        { type: 'base', anchor: 'posting_hand' },
      ],
    };
    const r = parseSpecResponse(long, dlr);
    expect(r.status === 'spec' && r.spec.annotations).toHaveLength(
      MAX_ANNOTATIONS,
    );
    expect(r.status === 'spec' && r.warnings.join()).toContain('soft cap');
  });
});

describe('parseSpecResponse — everything else degrades to no-spec, never a throw', () => {
  const cases: [string, unknown, string][] = [
    ['no response', undefined, 'unavailable'],
    ['a null response', null, 'unavailable'],
    ['a provider error', new Error('503 overloaded'), 'unavailable'],
    ['a blank string', '   \n', 'empty'],
    [
      'a spec with no annotations (the model declined)',
      { ...golden, annotations: [] },
      'empty',
    ],
    [
      'a spec missing annotations',
      { specVersion: 1, base: 'de-la-riva' },
      'empty',
    ],
    ['prose with no JSON', 'I cannot annotate this cue.', 'malformed'],
    ['truncated JSON', JSON.stringify(golden).slice(0, 60), 'malformed'],
    [
      'a dropped comma',
      '{"specVersion": 1 "base": "de-la-riva", "annotations": []}',
      'malformed',
    ],
    ['a JSON array', [golden], 'malformed'],
    ['a number', 42, 'malformed'],
    ['a boolean', true, 'malformed'],
    [
      'an unknown role',
      { ...golden, annotations: [{ type: 'base', anchor: 'opp_lapel' }] },
      'invalid',
    ],
    [
      'an unknown primitive',
      { ...golden, annotations: [{ type: 'squeeze', anchor: 'hook_heel' }] },
      'invalid',
    ],
    ['a different base', { ...golden, base: 'closed-guard' }, 'invalid'],
    [
      'annotations that are not a list',
      { ...golden, annotations: 'force' },
      'invalid',
    ],
  ];

  it.each(cases)('%s', (_label, response, reason) => {
    expect(() => parseSpecResponse(response, dlr)).not.toThrow();
    const r = parseSpecResponse(response, dlr);
    expect(r).toMatchObject({ status: 'no-spec', reason });
    expect(r.status === 'no-spec' && r.detail.length).toBeGreaterThan(0);
  });

  it('a hostile object', () => {
    const hostile = Object.defineProperty({}, 'annotations', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    expect(() => parseSpecResponse(hostile, dlr)).not.toThrow();
    expect(parseSpecResponse(hostile, dlr).status).toBe('no-spec');
  });

  it('does not mutate the response it was given', () => {
    const response = { annotations: [...golden.annotations] };
    parseSpecResponse(response, dlr);
    expect(response).toEqual({ annotations: golden.annotations });
  });
});

describe('single-sourcing — the edge function can import these modules', () => {
  // Same contract as src/sports/grounding.ts: relative `.ts` specifiers only,
  // no `@/` alias, no node / React / React Native, no packages. Phase b
  // imports them from supabase/functions/ unchanged.
  const DIR = join(__dirname, '..', '..', 'src', 'visualization');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s imports only sibling .ts modules', (file) => {
    const source = readFileSync(join(DIR, file), 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map(
      (m) => m[1],
    );
    for (const s of specifiers) expect(s).toMatch(/^\.\/[A-Za-z]+\.ts$/);
    expect(source).not.toMatch(/\brequire\(|process\.env|import\(/);
  });
});
