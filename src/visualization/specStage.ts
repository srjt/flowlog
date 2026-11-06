/**
 * Cue -> spec STAGE helpers (#135). Pure pieces only: the structured-output
 * schema, the prompt, and the response parser. The model call itself — a
 * best-effort stage after the quality gate in `FlowlogPipeline` and the
 * `process-session` edge function — is phase b and lives with the providers.
 *
 * The posture is strictly additive: whatever the model returns (nothing, a
 * truncated string, a spec naming a role the base lacks), `parseSpecResponse`
 * answers with either a validated spec or "no spec", and never throws. A
 * failure here must never fail a session; the cue simply shows as text.
 *
 * Sport-agnostic: the base supplies the roles, the caller supplies the sport's
 * expert persona from `src/sports/{sport}/` (rule 3), and nothing here names a
 * sport.
 *
 * Dependency-free on purpose (relative `.ts` imports only) so the edge
 * function can import it like `src/sports/*`.
 */

import {
  INTENSITIES,
  MAX_ANNOTATIONS,
  PRIMITIVES,
  PRIMITIVE_NAMES,
  SPEC_VERSION,
  describeGrammar,
} from './grammar.ts';
import { roleNames } from './keypoints.ts';
import type { DiagramBase } from './keypoints.ts';
import { validateSpec } from './validateSpec.ts';
import type { ValidatedSpec } from './validateSpec.ts';

/**
 * Version of the prompt + schema below. Stored alongside each spec so a change
 * in output quality is attributable. `0.1.0` was the #18 harness prompt; 0.2.0
 * drops its "pick the closest role" instruction in favour of an explicit empty
 * answer, adds the per-primitive schema, and takes the persona as input.
 */
export const SPEC_PROMPT_VERSION = '0.2.0';

/** The JSON Schema subset the constraint uses. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer';
  description?: string;
  enum?: (string | number)[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  anyOf?: JsonSchema[];
}

/**
 * The structured-output constraint for one base: the base's role enum crossed
 * with the grammar. One `anyOf` variant per primitive pins its arity (one role,
 * or exactly two for `grip`) and its legal relation kinds, so a provider that
 * enforces the schema cannot even emit an unknown role or an illegal relation.
 *
 * Plain JSON Schema (lowercase types, no `$ref`), which is what tool-input and
 * JSON-schema response modes accept. It is a convenience, not the floor:
 * `parseSpecResponse` re-validates everything, so a provider that ignores part
 * of the schema still cannot get an invalid spec through.
 */
export function buildSpecSchema(base: DiagramBase): JsonSchema {
  const roleEnum = (): JsonSchema => ({
    type: 'string',
    enum: roleNames(base),
  });
  const variants = PRIMITIVE_NAMES.map((name): JsonSchema => {
    const p = PRIMITIVES[name];
    const properties: Record<string, JsonSchema> = {
      type: { type: 'string', enum: [name] },
      anchor:
        p.arity === 1
          ? roleEnum()
          : { type: 'array', items: roleEnum(), minItems: 2, maxItems: 2 },
      intensity: { type: 'string', enum: [...INTENSITIES] },
    };
    const required = ['type', 'anchor'];
    if (p.relation.requirement !== 'none') {
      properties.relation = {
        anyOf: p.relation.kinds.map((kind) => ({
          type: 'object',
          properties: { [kind]: roleEnum() },
          required: [kind],
          additionalProperties: false,
        })),
      };
      if (p.relation.requirement === 'required') required.push('relation');
    }
    return {
      type: 'object',
      description: p.describe,
      properties,
      required,
      additionalProperties: false,
    };
  });
  return {
    type: 'object',
    properties: {
      specVersion: { type: 'integer', enum: [SPEC_VERSION] },
      base: { type: 'string', enum: [base.id] },
      annotations: {
        type: 'array',
        maxItems: MAX_ANNOTATIONS,
        items: { anyOf: variants },
      },
    },
    required: ['specVersion', 'base', 'annotations'],
    additionalProperties: false,
  };
}

export interface SpecPromptOptions {
  /**
   * Who the model speaks as, e.g. the sport's expert persona, supplied from
   * `src/sports/{sport}/`. Defaults to a sport-neutral coach.
   */
  expert?: string;
}

/** The prompt for one (base, cue). Deterministic for the same inputs. */
export function buildSpecPrompt(
  base: DiagramBase,
  cue: string,
  opts: SpecPromptOptions = {},
): string {
  const expert = opts.expert?.trim() || 'an expert coach';
  const roles = roleNames(base)
    .map((r) => `- ${r}`)
    .join('\n');
  return `You are ${expert} annotating a mechanical force diagram.

You are given ONE coaching cue and a fixed base position, already drawn as two figures: "you" (the person the cue is for) and "opponent". Output a small structured spec of the mechanical annotations a renderer will draw over the figures. Do not describe the position itself; annotate only the mechanic the cue is about.

BASE POSITION: ${JSON.stringify(base.label)} (id: ${JSON.stringify(base.id)})

AVAILABLE ROLES (the only named points you may reference; "your_" roles are on your body, "opp_" roles on the opponent's, the rest are named limbs or contact points):
${roles}

ANNOTATION GRAMMAR (the only primitive types allowed):
${describeGrammar()}

RULES:
- Direction is always role-relative: a relation is exactly one of {"toward": <role>}, {"away_from": <role>} or {"around": <role>}. Never use angles or coordinates.
- Reference only roles from the AVAILABLE ROLES list, spelled exactly. Never invent a role.
- A relation must name a different point from the anchor.
- "anchor" is a single role for every primitive except "grip", which takes exactly two roles: [gripping hand, gripped target].
- Annotate only what the cue states. Order annotations by importance. At most ${MAX_ANNOTATIONS}; 1 to 3 is typical.
- If the cue's mechanic cannot be placed on the available roles, return an empty "annotations" array. The cue is then shown as text alone, which is always better than a wrong diagram.

CUE: ${JSON.stringify(cue)}

Respond with only the JSON object: {"specVersion": ${SPEC_VERSION}, "base": ${JSON.stringify(base.id)}, "annotations": [...]}`;
}

/** Why the stage produced no spec. */
export type NoSpecReason =
  /** No response at all: the call failed, timed out, or was skipped. */
  | 'unavailable'
  /** A response that is not a JSON object. */
  | 'malformed'
  /** A blank response, or a spec with no annotations (the model declined). */
  | 'empty'
  /** A well-formed spec that fails validation against the base. */
  | 'invalid';

export type SpecStageResult =
  | { status: 'spec'; spec: ValidatedSpec; warnings: string[] }
  | { status: 'no-spec'; reason: NoSpecReason; detail: string[] };

const noSpec = (
  reason: NoSpecReason,
  ...detail: string[]
): SpecStageResult => ({
  status: 'no-spec',
  reason,
  detail,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Text models wrap JSON in prose or code fences even when asked not to. Take
 * the outermost `{…}`, as the prototype did.
 */
function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(unfenced.slice(start, end + 1));
}

/**
 * Turn a model response into a validated spec, or "no spec". Accepts the raw
 * text (possibly fenced or wrapped in prose), an already-parsed object (a
 * tool-use input), or nothing at all. A missing `specVersion` / `base` is
 * filled from the request — the model was only ever asked about this base —
 * but a DIFFERENT base is rejected. Never throws.
 */
export function parseSpecResponse(
  response: unknown,
  base: DiagramBase,
): SpecStageResult {
  try {
    if (
      response === undefined ||
      response === null ||
      response instanceof Error
    )
      return noSpec('unavailable', 'no response');

    let parsed: unknown = response;
    if (typeof response === 'string') {
      if (response.trim() === '') return noSpec('empty', 'blank response');
      try {
        parsed = extractJson(response);
      } catch (e) {
        return noSpec(
          'malformed',
          e instanceof Error ? e.message : 'unparseable response',
        );
      }
    }
    if (!isRecord(parsed))
      return noSpec('malformed', 'response is not a JSON object');

    const candidate: Record<string, unknown> = { ...parsed };
    if (candidate.specVersion === undefined)
      candidate.specVersion = SPEC_VERSION;
    if (candidate.base === undefined) candidate.base = base.id;
    if (
      candidate.annotations === undefined ||
      (Array.isArray(candidate.annotations) &&
        candidate.annotations.length === 0)
    )
      return noSpec('empty', 'no annotations');

    const v = validateSpec(candidate, base);
    return v.ok
      ? { status: 'spec', spec: v.spec, warnings: v.warnings }
      : noSpec('invalid', ...v.errors);
  } catch {
    return noSpec('malformed', 'response could not be read');
  }
}
