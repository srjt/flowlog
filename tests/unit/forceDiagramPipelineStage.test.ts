/**
 * The cue -> spec pipeline stage's DECISIONS (#135 phase b), run for real.
 *
 * `runDiagramStage` is the one function both the client reference pipeline and
 * the `process-session` edge function call, so what it does here is what the
 * Deno function does too. One seam: the `DiagramRecord` a Session is written
 * with, plus whether the model was called at all.
 *
 * Fixture bases are the #18 seeds, UNCERTIFIED, re-keyed by a canonical sided
 * id as phase c will key real ones. Test data only.
 */
import { GRAMMAR_VERSION, SPEC_VERSION } from '@/visualization/grammar';
import type { DiagramBase } from '@/visualization/keypoints';
import {
  DIAGRAM_OUTCOMES,
  NOT_ATTEMPTED,
  SPEC_STAGE_TIMEOUT_MS,
  STAGE_FAILED,
  runDiagramStage,
  type DiagramLibrary,
  type DiagramRecord,
  type DiagramStageInput,
  type SpecRequest,
} from '@/visualization/diagramStage';
import {
  SPEC_PROMPT_VERSION,
  buildSpecPrompt,
  buildSpecSchema,
} from '@/visualization/specStage';
import { referenceSpec, seedBase } from '../fixtures/forceDiagram/seeds';

const POSITION = 'de-la-riva-bottom';
const BASE: DiagramBase = { ...seedBase('de-la-riva'), id: POSITION };
const LIBRARY: DiagramLibrary = {
  bases: { [POSITION]: BASE },
  baseLibraryVersion: 'fixture-uncertified',
  specPersona: 'a test instructor',
};
const CUE =
  "Drive your hooking heel into their hamstring so they can't step forward.";
const GOLDEN = referenceSpec('de-la-riva', 'heel-hamstring').annotations;
const ANSWER = {
  specVersion: SPEC_VERSION,
  base: POSITION,
  annotations: GOLDEN,
};

/** A call that records what it was asked and answers `answer`. */
function spy(answer: unknown | (() => Promise<unknown>)) {
  const calls: SpecRequest[] = [];
  const call = async (request: SpecRequest) => {
    calls.push(request);
    return typeof answer === 'function'
      ? (answer as () => Promise<unknown>)()
      : answer;
  };
  return { calls, call };
}

function run(overrides: Partial<DiagramStageInput> = {}, answer?: unknown) {
  const s = spy(answer === undefined ? ANSWER : answer);
  const input: DiagramStageInput = {
    library: LIBRARY,
    cue: CUE,
    coachable: true,
    positionId: POSITION,
    call: s.call,
    ...overrides,
  };
  return { calls: s.calls, result: runDiagramStage(input) };
}

const PROMPTED = {
  grammarVersion: GRAMMAR_VERSION,
  baseLibraryVersion: 'fixture-uncertified',
  specPromptVersion: SPEC_PROMPT_VERSION,
};

describe('a spec is stored with its provenance', () => {
  it('records the validated spec and all three versions', async () => {
    const { calls, result } = run();
    const { record } = await result;
    expect(record).toEqual({
      diagramOutcome: 'spec',
      diagramSpec: ANSWER,
      ...PROMPTED,
    });
    expect(calls).toHaveLength(1);
  });

  it('sends the phase a prompt and schema for this base, with the sport persona', async () => {
    const { calls, result } = run();
    await result;
    expect(calls[0]).toEqual({
      prompt: buildSpecPrompt(BASE, CUE, { expert: 'a test instructor' }),
      schema: buildSpecSchema(BASE),
      timeoutMs: SPEC_STAGE_TIMEOUT_MS,
    });
  });

  it('accepts raw model text, fenced or not', async () => {
    const fenced = '```json\n' + JSON.stringify(ANSWER) + '\n```';
    const { record } = await run({}, fenced).result;
    expect(record.diagramOutcome).toBe('spec');
    expect(record.diagramSpec).toEqual(ANSWER);
  });

  it('stores the cleaned spec, not the raw answer', async () => {
    const noisy = {
      ...ANSWER,
      chatter: 'here is your spec',
      annotations: [{ ...(GOLDEN[0] as object), extra: 1 }],
    };
    const { record } = await run({}, noisy).result;
    expect(record.diagramSpec).toEqual({ ...ANSWER, annotations: [GOLDEN[0]] });
  });
});

// The property that makes phase b inert: no Cue or no base, no call.
describe('no model call unless the Cue is real and a base resolves', () => {
  it.each([
    ['a declined Take or the gate fallback', { coachable: false }],
    ['a null Cue', { cue: null }],
    ['a blank Cue', { cue: '   ' }],
  ])('%s: not_attempted', async (_label, overrides) => {
    const { calls, result } = run(overrides);
    const { record } = await result;
    expect(record).toEqual(NOT_ATTEMPTED);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['a position with no authored base', 'side-control-bottom'],
    ['the other side of an authored position', 'de-la-riva-top'],
    ['an unresolved position', null],
    ['an inherited key, not an own base', 'constructor'],
    ['the prototype key', '__proto__'],
  ])('%s: no_base, naming the library', async (_label, positionId) => {
    const { calls, result } = run({ positionId });
    const { record } = await result;
    expect(record).toEqual({
      diagramOutcome: 'no_base',
      diagramSpec: null,
      grammarVersion: null,
      baseLibraryVersion: 'fixture-uncertified',
      specPromptVersion: null,
    });
    expect(calls).toHaveLength(0);
  });

  it('a sport with no library: no_base, no version, no call', async () => {
    const { calls, result } = run({ library: undefined });
    const { record } = await result;
    expect(record.diagramOutcome).toBe('no_base');
    expect(record.baseLibraryVersion).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a registered base that fails parseBase is never sent to the model', async () => {
    const broken = { ...BASE, roles: {} } as DiagramBase;
    const { calls, result } = run({
      library: { ...LIBRARY, bases: { [POSITION]: broken } },
    });
    const { record, detail } = await result;
    expect(record.diagramOutcome).toBe('no_base');
    expect(calls).toHaveLength(0);
    expect(detail.join(' ')).toMatch(/unusable/);
  });
});

describe('a bad answer records why, and never a spec', () => {
  it.each<[string, unknown, DiagramRecord['diagramOutcome']]>([
    [
      'no annotations: the prompt’s own escape hatch',
      { annotations: [] },
      'empty',
    ],
    ['a blank answer', '   ', 'empty'],
    ['prose with no JSON', 'I cannot draw that.', 'invalid'],
    ['a JSON array', [ANSWER], 'invalid'],
    [
      'a role the base does not have',
      { ...ANSWER, annotations: [{ type: 'base', anchor: 'opp_lapel' }] },
      'invalid',
    ],
    [
      'an illegal relation',
      {
        ...ANSWER,
        annotations: [
          {
            type: 'pressure',
            anchor: 'hook_heel',
            relation: { toward: 'opp_hip' },
          },
        ],
      },
      'invalid',
    ],
    [
      'a spec for another base',
      { ...ANSWER, base: 'closed-guard-bottom' },
      'invalid',
    ],
    ['no answer at all', null, 'unavailable'],
  ])('%s: %s', async (_label, answer, outcome) => {
    const { calls, result } = run({}, answer);
    const { record } = await result;
    expect(record).toEqual({
      diagramOutcome: outcome,
      diagramSpec: null,
      ...PROMPTED,
    });
    expect(calls).toHaveLength(1);
  });

  it('a call that throws: unavailable, and the stage does not throw', async () => {
    const { result } = run({}, () => Promise.reject(new Error('503')));
    await expect(result).resolves.toMatchObject({
      record: { diagramOutcome: 'unavailable', diagramSpec: null, ...PROMPTED },
      detail: ['503'],
    });
  });

  it('a call that throws synchronously: unavailable', async () => {
    const { record } = await runDiagramStage({
      library: LIBRARY,
      cue: CUE,
      coachable: true,
      positionId: POSITION,
      call: () => {
        throw new Error('boom');
      },
    });
    expect(record.diagramOutcome).toBe('unavailable');
  });

  it('a call that never answers: unavailable at the deadline', async () => {
    const { result } = run({ timeoutMs: 10 }, () => new Promise(() => {}));
    const { record, detail } = await result;
    expect(record.diagramOutcome).toBe('unavailable');
    expect(detail[0]).toMatch(/within 10ms/);
  });

  it('a hostile library: the backstop record, never a throw', async () => {
    const hostile = Object.defineProperty({}, 'baseLibraryVersion', {
      get() {
        throw new Error('boom');
      },
    }) as DiagramLibrary;
    const { record } = await runDiagramStage({
      library: hostile,
      cue: CUE,
      coachable: true,
      positionId: POSITION,
      call: async () => ANSWER,
    });
    expect(record).toEqual(STAGE_FAILED);
  });
});

// What the migration's comments promise about every row.
describe('every record keeps the column rules', () => {
  const cases: [string, Partial<DiagramStageInput>, unknown][] = [
    ['spec', {}, ANSWER],
    ['no_base', { positionId: 'mount-bottom' }, ANSWER],
    ['not_attempted', { coachable: false }, ANSWER],
    ['empty', {}, { annotations: [] }],
    ['invalid', {}, 'nonsense'],
    ['unavailable', {}, null],
  ];

  it('covers every outcome', () => {
    expect(cases.map(([o]) => o).sort()).toEqual([...DIAGRAM_OUTCOMES].sort());
  });

  it.each(cases)('%s', async (outcome, overrides, answer) => {
    const { record } = await run(overrides, answer).result;
    expect(record.diagramOutcome).toBe(outcome);
    // A spec exactly when the outcome is `spec`.
    expect(record.diagramSpec !== null).toBe(outcome === 'spec');
    // The library version whenever the library was consulted.
    expect(record.baseLibraryVersion !== null).toBe(
      outcome !== 'not_attempted',
    );
    // The grammar and prompt versions exactly when a prompt was built.
    const prompted = !['no_base', 'not_attempted'].includes(outcome);
    expect(record.grammarVersion !== null).toBe(prompted);
    expect(record.specPromptVersion !== null).toBe(prompted);
  });

  it('hands out copies, so a caller cannot corrupt the shared records', async () => {
    const { record } = await run({ coachable: false }).result;
    expect(record).not.toBe(NOT_ATTEMPTED);
    expect(Object.isFrozen(NOT_ATTEMPTED)).toBe(true);
    expect(Object.isFrozen(STAGE_FAILED)).toBe(true);
  });
});
