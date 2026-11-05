/**
 * The cue -> spec pipeline STAGE (#135 phase b): when it runs, the one model
 * call under a timeout, and the outcome + provenance a Session records.
 *
 * `specStage.ts` holds the pure pieces (prompt, schema, parser). This module
 * decides whether to use them, and turns whatever happens into one
 * `DiagramRecord`. It is shared by `FlowlogPipeline` (through
 * `DiagramSpecService`) and the `process-session` edge function, so the two
 * cannot disagree about when a model call is made or what a row says about
 * it. The hand-maintained mirror has drifted before (docs/PIPELINE.md); the
 * decision logic is the part worth single-sourcing.
 *
 * The model call itself is injected (`call`), because it needs a provider and
 * secrets: `IAIProvider.generateDiagramSpec` on the client and
 * `generateDiagramSpec` in `supabase/functions/_shared/ai.ts` on the server.
 *
 * Best-effort, strictly: `runDiagramStage` never throws, never touches the Cue,
 * and makes NO model call unless the Cue is real and a base resolves for the
 * Session's canonical position. Until certified bases exist (phase c, #136)
 * every library is empty, so in production this records `no_base` and calls
 * nothing: zero cost, zero latency, zero effect on the Cue.
 *
 * Dependency-free on purpose (relative `.ts` imports only) so the edge
 * function can import it like `src/sports/*`.
 */

import { GRAMMAR_VERSION } from './grammar.ts';
import { parseBase } from './keypoints.ts';
import type { DiagramBase } from './keypoints.ts';
import {
  SPEC_PROMPT_VERSION,
  buildSpecPrompt,
  buildSpecSchema,
  parseSpecResponse,
} from './specStage.ts';
import type { JsonSchema, NoSpecReason } from './specStage.ts';
import type { ValidatedSpec } from './validateSpec.ts';

/**
 * Why a Session does or does not have a diagram spec. Exactly the values
 * `sessions.diagram_outcome` accepts (migration 025); a test holds the two
 * together, because a value the CHECK rejects fails the whole Session write.
 *
 *   spec           a validated spec is stored
 *   no_base        no certified base for the Session's position (or no
 *                  position at all): no model call was made
 *   not_attempted  no coachable Cue: a declined Take, or the quality gate's
 *                  fallback. No model call was made
 *   empty          the model was asked and returned no annotations: the
 *                  mechanic could not be placed on the base's roles, which the
 *                  prompt tells it to answer rather than draw a wrong picture
 *   invalid        the model answered with something that failed validation
 *                  (malformed JSON, an unknown role, an illegal relation)
 *   unavailable    the model call failed or timed out
 *
 * Derived from `NoSpecReason` (see `OUTCOME_FOR`): `malformed` and `invalid`
 * are one outcome because they share a fix (the prompt or the schema), while
 * `empty` stays apart because it is the answer the prompt asks for, and
 * counting it as an error would make the model's error rate unmeasurable.
 */
export const DIAGRAM_OUTCOMES = [
  'spec',
  'no_base',
  'not_attempted',
  'empty',
  'invalid',
  'unavailable',
] as const;

export type DiagramOutcome = (typeof DIAGRAM_OUTCOMES)[number];

/** How each of the parser's reasons is recorded. */
const OUTCOME_FOR: Readonly<Record<NoSpecReason, DiagramOutcome>> = {
  unavailable: 'unavailable',
  malformed: 'invalid',
  empty: 'empty',
  invalid: 'invalid',
};

/**
 * What a Session records about its diagram. Field names match the Session
 * domain type, so a caller spreads it straight into a write.
 *
 * Provenance is stored ALONGSIDE the spec, never inside it, so the spec stays
 * a re-renderable record. A version is written only when that piece took part
 * in the outcome, so NULL keeps meaning "not involved" rather than "unknown".
 */
export interface DiagramRecord {
  diagramOutcome: DiagramOutcome;
  /** Non-null exactly when `diagramOutcome` is `spec`. */
  diagramSpec: ValidatedSpec | null;
  /** Set whenever a prompt was built (spec, empty, invalid, unavailable). */
  grammarVersion: string | null;
  /** Set whenever the base library was consulted (every outcome but not_attempted). */
  baseLibraryVersion: string | null;
  /** Set whenever a prompt was built (spec, empty, invalid, unavailable). */
  specPromptVersion: string | null;
}

/**
 * A sport's force-diagram base library (`src/sports/{sport}/`, rule 3). Bases
 * are keyed by the canonical SIDED position id (`de-la-riva-bottom`), because
 * `you` in a base must be the practitioner's side of the position.
 */
export interface DiagramLibrary {
  bases: Readonly<Record<string, DiagramBase>>;
  /** Stored with every outcome that consulted the library. */
  baseLibraryVersion: string;
  /** Who the spec model speaks as (`buildSpecPrompt`'s `expert`). */
  specPersona: string;
}

/** One model call: the prompt, its structured-output schema, and a deadline. */
export interface SpecRequest {
  prompt: string;
  /**
   * The base's role enum crossed with the grammar (`buildSpecSchema`). Handed
   * over so a provider that can enforce it may; the default providers do not
   * (see `generateDiagramSpec`), and `parseSpecResponse` is the floor either
   * way.
   */
  schema: JsonSchema;
  /** Abort the request after this long. */
  timeoutMs: number;
}

/**
 * Makes the model call. Resolves to the raw response (text or a parsed
 * object), or null when there is none. Should not throw; if it does, the
 * stage records `unavailable`.
 */
export type SpecCall = (request: SpecRequest) => Promise<unknown>;

/**
 * How long the stage waits for the model. It sits after the quality gate and
 * before the Session is written, so in phase c every Session with a base
 * waits up to this long. A timeout costs only the diagram (the Cue shows as
 * text) and is recorded as `unavailable`, so the right value can be read off
 * the rows rather than guessed: tune it from the `unavailable` rate once
 * bases exist.
 */
export const SPEC_STAGE_TIMEOUT_MS = 6000;

const record = (
  diagramOutcome: DiagramOutcome,
  fields: Partial<Omit<DiagramRecord, 'diagramOutcome'>> = {},
): DiagramRecord => ({
  diagramOutcome,
  diagramSpec: null,
  grammarVersion: null,
  baseLibraryVersion: null,
  specPromptVersion: null,
  ...fields,
});

/**
 * The record for a Session with no coachable Cue: the declined Take, and the
 * declined Re-analyze, which must also CLEAR an earlier spec so it never
 * describes a Cue the row no longer holds.
 */
export const NOT_ATTEMPTED: Readonly<DiagramRecord> = Object.freeze(
  record('not_attempted'),
);

/**
 * What a caller records if the stage itself threw. It does not, by
 * construction; this is the backstop behind the backstop, so the Session is
 * written either way.
 */
export const STAGE_FAILED: Readonly<DiagramRecord> = Object.freeze(
  record('unavailable'),
);

export interface DiagramStageInput {
  /** The sport's library, or undefined for a sport that has none. */
  library: DiagramLibrary | undefined;
  /** The Cue the Session will hold. */
  cue: string | null;
  /**
   * Whether that Cue is a real one: the quality gate passed without using its
   * fallback. The fallback is generic by design, so there is no mechanic in
   * it to draw.
   */
  coachable: boolean;
  /** The Session's canonical position id (`target_position_id`). */
  positionId: string | null;
  call: SpecCall;
  /** Defaults to `SPEC_STAGE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface DiagramStageRun {
  record: DiagramRecord;
  /** Why, in words, for logs. Never stored. */
  detail: string[];
}

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

const TIMED_OUT = Symbol('timed out');

/**
 * Resolve to `TIMED_OUT` if `work` has not settled in `ms`. A backstop for a
 * call that ignores its own deadline; the timer is always cleared, so nothing
 * is left pending once the stage returns.
 */
async function within<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run the stage for one Session. In order:
 *
 *   1. No coachable Cue          -> `not_attempted`, no call.
 *   2. No base for the position  -> `no_base`, no call.
 *   3. One model call, under a deadline, parsed and validated against the
 *      base -> `spec`, or `empty` / `invalid` / `unavailable`.
 *
 * Never throws, and never reads or changes anything but its inputs.
 */
export async function runDiagramStage(
  input: DiagramStageInput,
): Promise<DiagramStageRun> {
  try {
    const cue = input.cue ?? '';
    if (!input.coachable || !cue.trim())
      return {
        record: { ...NOT_ATTEMPTED },
        detail: ['no coachable cue'],
      };

    const library = input.library;
    if (!library)
      return {
        record: record('no_base'),
        detail: ['the sport has no diagram library'],
      };
    const consulted = { baseLibraryVersion: library.baseLibraryVersion };

    const id = input.positionId;
    // Own-property lookup, so an id such as "constructor" is simply absent.
    const authored =
      id && hasOwn(library.bases, id) ? library.bases[id] : undefined;
    if (!authored)
      return {
        record: record('no_base', consulted),
        detail: [id ? `no base for ${id}` : 'no canonical position'],
      };

    // A registered base that fails the structural gate is an authoring bug
    // (a test guards against it). Never spend a call against it.
    const parsed = parseBase(authored);
    if (!parsed.ok)
      return {
        record: record('no_base', consulted),
        detail: [`base for ${id} is unusable`, ...parsed.errors],
      };
    const base = parsed.base;

    const prompted = {
      ...consulted,
      grammarVersion: GRAMMAR_VERSION,
      specPromptVersion: SPEC_PROMPT_VERSION,
    };
    const timeoutMs = input.timeoutMs ?? SPEC_STAGE_TIMEOUT_MS;
    const request: SpecRequest = {
      prompt: buildSpecPrompt(base, cue, {
        expert: library.specPersona,
      }),
      schema: buildSpecSchema(base),
      timeoutMs,
    };

    let response: unknown;
    try {
      const answer = await within(input.call(request), timeoutMs);
      if (answer === TIMED_OUT)
        return {
          record: record('unavailable', prompted),
          detail: [`no response within ${timeoutMs}ms`],
        };
      response = answer;
    } catch (err) {
      return {
        record: record('unavailable', prompted),
        detail: [err instanceof Error ? err.message : 'the call failed'],
      };
    }

    const result = parseSpecResponse(response, base);
    if (result.status === 'spec')
      return {
        record: record('spec', { ...prompted, diagramSpec: result.spec }),
        detail: result.warnings,
      };
    return {
      record: record(OUTCOME_FOR[result.reason], prompted),
      detail: [result.reason, ...result.detail],
    };
  } catch {
    return {
      record: { ...STAGE_FAILED },
      detail: ['the diagram stage failed'],
    };
  }
}
