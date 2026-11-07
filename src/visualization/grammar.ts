/**
 * Force-diagram annotation GRAMMAR (#135, from the #17 domain model / #18
 * prototype).
 *
 * Nine closed, versioned mechanical primitives sharing one envelope:
 *
 *   { type, anchor: role | [role, role], relation?: { toward | away_from | around: role }, intensity? }
 *
 * Direction is ALWAYS role-relative — a relation names another role, never an
 * angle or a coordinate. The renderer owns geometry; the spec stage only picks
 * named roles. That is what makes a spec impossible to aim at a point the base
 * does not have.
 *
 * This module is the single source of truth for BOTH the spec prompt (it
 * describes the grammar to the model) and the validator (it enforces arity and
 * relation rules). It knows nothing about any sport or position.
 *
 * Dependency-free on purpose, with relative `.ts` imports only: it is meant to
 * be imported by BOTH the client AND the Supabase edge function, exactly like
 * `src/sports/grounding.ts`. Keep it free of any `@/`, node, or React Native
 * imports, and of enums / namespaces (plain consts and types only).
 */

/**
 * Version of the primitive catalogue: names, arity and relation rules. Stored
 * alongside every spec (never inside it) so a diagram states which grammar
 * produced it. Bump on any change to `PRIMITIVES`.
 */
export const GRAMMAR_VERSION = '0.1.0';

/** Version of the spec envelope itself (`{ specVersion, base, annotations }`). */
export const SPEC_VERSION = 1;

/**
 * Soft cap on annotations per spec, so the diagram stays legible.
 *
 * Enforced in three places, softest first: the prompt asks for 1–3 and at most
 * this many; the structured-output schema sets `maxItems`; and the validator
 * TRUNCATES anything longer to the first `MAX_ANNOTATIONS` with a warning
 * rather than rejecting it. Annotations are ordered by importance, so the head
 * of an over-long spec is still a faithful diagram of the cue — dropping its
 * tail loses detail, never correctness.
 */
export const MAX_ANNOTATIONS = 4;

export const PRIMITIVE_NAMES = [
  'force',
  'rotation',
  'pressure',
  'frame',
  'base',
  'counter',
  'grip',
  'weight-distribution',
  'movement-path',
] as const;

export type PrimitiveName = (typeof PRIMITIVE_NAMES)[number];

export const INTENSITIES = ['low', 'medium', 'high'] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const RELATION_KINDS = ['toward', 'away_from', 'around'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Exactly one role-relative direction or pivot. */
export type Relation =
  | { toward: string }
  | { away_from: string }
  | { around: string };

export interface Annotation {
  type: PrimitiveName;
  /** One role, or `[gripping, gripped]` for the two-anchor `grip`. */
  anchor: string | [string, string];
  relation?: Relation;
  intensity?: Intensity;
}

/**
 * The spec: pure and minimal. Provenance (`GRAMMAR_VERSION`, the base library
 * version, `SPEC_PROMPT_VERSION`) is stored ALONGSIDE it, never inside, so the
 * spec stays a re-renderable record.
 */
export interface Spec {
  specVersion: number;
  /** Id of the diagram base the spec annotates. */
  base: string;
  /** Ordered by importance. */
  annotations: Annotation[];
}

export interface PrimitiveSpec {
  /** How many roles `anchor` carries. */
  arity: 1 | 2;
  relation: {
    requirement: 'required' | 'optional' | 'none';
    kinds: readonly RelationKind[];
  };
  /** One line handed to the spec model. */
  describe: string;
}

export const PRIMITIVES: Readonly<Record<PrimitiveName, PrimitiveSpec>> = {
  force: {
    arity: 1,
    relation: { requirement: 'required', kinds: ['toward', 'away_from'] },
    describe:
      'A directed force applied at a point, e.g. a heel driving into a target. ' +
      'anchor = where the force originates; relation.toward / relation.away_from = the role it drives into or away from.',
  },
  rotation: {
    arity: 1,
    relation: { requirement: 'required', kinds: ['around'] },
    describe:
      'A rotational or turning action. anchor = what turns; relation.around = the pivot role it turns about.',
  },
  pressure: {
    arity: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'Concentrated pressure into a single contact point, e.g. a chest bearing down. ' +
      'anchor = the contact point. No direction.',
  },
  frame: {
    arity: 1,
    relation: { requirement: 'optional', kinds: ['away_from'] },
    describe:
      'A rigid strut that holds distance. anchor = the framing limb; ' +
      'relation.away_from = what it holds off (optional).',
  },
  base: {
    arity: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'A base, support or post that keeps you stable. anchor = the supporting limb or point. No direction.',
  },
  counter: {
    arity: 1,
    relation: { requirement: 'required', kinds: ['toward', 'away_from'] },
    describe:
      "The OPPONENT's force being blocked. anchor = where you block it; " +
      'relation.toward / relation.away_from = the direction their force is trying to go (drawn as blocked).',
  },
  grip: {
    arity: 2,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'A grip connecting two points. anchor = [the gripping hand, the gripped target]. No direction.',
  },
  'weight-distribution': {
    arity: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'Where body weight is settled. anchor = the point the weight bears through. No direction.',
  },
  'movement-path': {
    arity: 1,
    relation: { requirement: 'required', kinds: ['toward'] },
    describe:
      'A path a limb or body should travel. anchor = what moves; relation.toward = the destination role.',
  },
};

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/**
 * Narrow an arbitrary value to a primitive name. Own-property check, so
 * `"constructor"` or `"__proto__"` are unknown primitives, not crashes.
 */
export function isPrimitiveName(value: unknown): value is PrimitiveName {
  return typeof value === 'string' && hasOwn(PRIMITIVES, value);
}

/** The kind and target role of a (validated) relation. */
export function relationOf(
  relation: Relation | undefined,
): { kind: RelationKind; role: string } | null {
  if (!relation) return null;
  if ('toward' in relation) return { kind: 'toward', role: relation.toward };
  if ('away_from' in relation)
    return { kind: 'away_from', role: relation.away_from };
  if ('around' in relation) return { kind: 'around', role: relation.around };
  return null;
}

/** The anchor as a list of roles, whatever its arity. */
export function anchorRoles(annotation: Annotation): string[] {
  return Array.isArray(annotation.anchor)
    ? [...annotation.anchor]
    : [annotation.anchor];
}

/**
 * A compact, model-facing description of the whole grammar: one line per
 * primitive with its arity and relation rule.
 */
export function describeGrammar(): string {
  return PRIMITIVE_NAMES.map((name) => {
    const p = PRIMITIVES[name];
    const rel =
      p.relation.requirement === 'none'
        ? 'no relation'
        : `relation ${p.relation.requirement} (${p.relation.kinds.join(' | ')})`;
    const arity = p.arity === 1 ? '1 anchor role' : `${p.arity} anchor roles`;
    return `- ${name}: ${arity}, ${rel}. ${p.describe}`;
  }).join('\n');
}
