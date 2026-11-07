import {
  CANVAS_H,
  CANVAS_W,
  parseBase,
  resolveRole,
  roleNames,
  toPx,
  type DiagramBase,
} from '@/visualization/keypoints';
import { SEED_IDS, SEED_JSON, seedBase } from '../fixtures/forceDiagram/seeds';

/** A tiny hand-built base so each resolution strategy has an exact answer. */
function base(over: Partial<DiagramBase> = {}): unknown {
  return {
    id: 'test-base',
    label: 'Test base',
    people: {
      you: {
        head: 'head',
        joints: { head: [0.1, 0.2], hip: [0.2, 0.6], foot: [0.6, 0.5] },
        bones: [
          ['head', 'hip'],
          ['hip', 'foot'],
        ],
      },
      opp: {
        head: 'head',
        joints: { head: [0.8, 0.2], hip: [0.8, 0.5], knee: [0.6, 0.7] },
        bones: [
          ['head', 'hip'],
          ['hip', 'knee'],
        ],
      },
    },
    roles: {
      your_hip: { joint: 'you.hip' },
      opp_thigh: { midpoint: ['opp.hip', 'opp.knee'] },
      opp_near_knee: { lerp: { between: ['opp.hip', 'opp.knee'], t: 0.75 } },
      heel_on_thigh: { point: [0.65, 0.58] },
    },
    ...over,
  };
}

function parsed(input: unknown = base()): DiagramBase {
  const r = parseBase(input);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.base;
}

const close = (actual: [number, number] | null, expected: [number, number]) => {
  expect(actual).not.toBeNull();
  expect(actual![0]).toBeCloseTo(expected[0], 10);
  expect(actual![1]).toBeCloseTo(expected[1], 10);
};

describe('resolveRole — role → coordinate', () => {
  it('resolves a joint role to that joint', () => {
    close(resolveRole(parsed(), 'your_hip'), [0.2, 0.6]);
  });

  it('resolves a midpoint role halfway between its two joints', () => {
    close(resolveRole(parsed(), 'opp_thigh'), [0.7, 0.6]);
  });

  it('resolves a lerp role at its fraction along the segment', () => {
    close(resolveRole(parsed(), 'opp_near_knee'), [0.65, 0.65]);
  });

  it('resolves a contact-point role to its explicit point, not to any joint', () => {
    // A contact decouples "heel on thigh" from the occluded foot joint.
    close(resolveRole(parsed(), 'heel_on_thigh'), [0.65, 0.58]);
  });

  it('rejects a role the base does not declare', () => {
    expect(resolveRole(parsed(), 'opp_lapel')).toBeNull();
  });

  it('rejects inherited object keys rather than resolving or crashing', () => {
    for (const role of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ])
      expect(resolveRole(parsed(), role)).toBeNull();
  });

  it('maps normalized coordinates onto the fixed landscape canvas', () => {
    expect(toPx([0.5, 1])).toEqual([CANVAS_W / 2, CANVAS_H]);
  });

  it('resolves the prototype spec example on the de-la-riva seed', () => {
    // The #135 example: heel driving into the hamstring, where the hamstring
    // is DERIVED (mid hip–knee) and the contact is an explicit point.
    const dlr = seedBase('de-la-riva');
    close(resolveRole(dlr, 'hook_heel'), [0.7, 0.52]);
    close(resolveRole(dlr, 'opp_hamstring'), [
      (0.7805 + 0.6829) / 2,
      (0.4904 + 0.6635) / 2,
    ]);
    close(resolveRole(dlr, 'heel_on_hamstring'), [0.705, 0.555]);
  });
});

describe('parseBase — the structural gate every base passes', () => {
  it.each(SEED_IDS)(
    'accepts the %s seed and resolves every role it declares',
    (id) => {
      const b = seedBase(id);
      expect(roleNames(b).length).toBeGreaterThan(0);
      for (const role of roleNames(b))
        expect(resolveRole(b, role)).not.toBeNull();
    },
  );

  it('returns a clean copy: unknown fields such as notes and cues are dropped', () => {
    const b = seedBase('de-la-riva') as unknown as Record<string, unknown>;
    expect(b.note).toBeUndefined();
    expect(b.cues).toBeUndefined();
    expect(
      (SEED_JSON['de-la-riva'] as Record<string, unknown>).cues,
    ).toBeDefined();
  });

  const reject = (input: unknown, fragment: string) => {
    const r = parseBase(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain(fragment);
  };

  it('rejects a role pointing at a joint that does not exist', () => {
    reject(
      base({ roles: { your_hook: { joint: 'you.hook_foot' } } }),
      'roles.your_hook',
    );
  });

  it('rejects a bone between joints that do not exist', () => {
    const b = base() as { people: { you: { bones: string[][] } } };
    b.people.you.bones.push(['hip', 'elbow']);
    reject(b, 'people.you.bones[2]');
  });

  it('rejects a contact point off the canvas', () => {
    reject(
      base({ roles: { heel_on_thigh: { point: [1.2, 0.5] } } }),
      'roles.heel_on_thigh',
    );
  });

  it('rejects a lerp fraction outside [0, 1]', () => {
    reject(
      base({
        roles: {
          opp_far: { lerp: { between: ['opp.hip', 'opp.knee'], t: 1.5 } },
        },
      }),
      'lerp.t',
    );
  });

  it('rejects a role with two resolution strategies', () => {
    reject(
      base({
        roles: { your_hip: { joint: 'you.hip', point: [0.2, 0.6] } } as never,
      }),
      'exactly one of',
    );
  });

  it('rejects role names that are not snake_case (they are handed to the model as an enum)', () => {
    reject(base({ roles: { 'Your Hip': { joint: 'you.hip' } } }), 'snake_case');
  });

  it('requires exactly the two drawn figures, you and opp', () => {
    const b = base() as { people: Record<string, unknown> };
    delete b.people.opp;
    reject(b, 'people.opp');
    const extra = base() as { people: Record<string, unknown> };
    extra.people.referee = extra.people.you;
    reject(extra, 'people.referee');
  });

  it('never throws, whatever it is handed', () => {
    const hostile = Object.defineProperty({}, 'id', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    for (const input of [null, undefined, 42, 'base', [], {}, hostile])
      expect(() => parseBase(input)).not.toThrow();
    expect(parseBase(hostile).ok).toBe(false);
  });
});
