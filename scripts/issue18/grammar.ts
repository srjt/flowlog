// #18 harness — the annotation GRAMMAR (implements the #17 domain-model
// resolution). Nine mechanical primitives with a uniform, semantic-only
// envelope; direction is always role-relative (toward / away_from / around a
// role), never a raw angle — the renderer owns geometry.
//
// This module is the single source of truth for BOTH the LLM (it describes the
// grammar in the spec prompt) and the validator (it enforces arity + known
// roles). Small, closed, versioned. See scripts/issue18/README.md.
//
// Runs under Node 24 type-stripping — plain interfaces + const objects only
// (no enums / namespaces / decorators).

export const GRAMMAR_VERSION = '0.1.0';
export const SPEC_VERSION = 1;

// ── The spec shape the LLM emits and the renderer consumes ──────────────────
// Pure + minimal: base + ordered annotations. Provenance lives ALONGSIDE the
// spec (on the harness result), never inside it, so the spec stays a
// re-renderable record. See #17 resolution point 3.

export type Intensity = 'low' | 'medium' | 'high';

export type Relation =
  | { toward: string }
  | { away_from: string }
  | { around: string };

export interface Annotation {
  /** Primitive name — must be a key of PRIMITIVES. */
  type: string;
  /** One or more semantic roles from the position's role map. */
  anchor: string | string[];
  /** Role-relative direction / pivot. Required for some primitives. */
  relation?: Relation;
  intensity?: Intensity;
}

export interface Spec {
  specVersion: number;
  /** Canonical base position id (the seed the renderer skins from). */
  base: string;
  /** Ordered by importance, soft-capped (see MAX_ANNOTATIONS). */
  annotations: Annotation[];
}

// Soft cap from #17 — keep the diagram legible; the LLM is told this and the
// validator warns (does not hard-fail) past it.
export const MAX_ANNOTATIONS = 4;

// ── Primitive catalogue ─────────────────────────────────────────────────────
// `anchors` is the exact number of roles the primitive attaches to (arity).
// `relation` declares whether a role-relative direction/pivot is required,
// optional, or disallowed, and which relation kinds are legal.

export type RelationKind = 'toward' | 'away_from' | 'around';

export interface PrimitiveSpec {
  /** Number of roles the `anchor` must carry. */
  anchors: number;
  relation: {
    requirement: 'required' | 'optional' | 'none';
    kinds: RelationKind[];
  };
  /** One-line description handed to the LLM. */
  describe: string;
}

export const PRIMITIVES: Record<string, PrimitiveSpec> = {
  force: {
    anchors: 1,
    relation: { requirement: 'required', kinds: ['toward', 'away_from'] },
    describe:
      'A directed force applied at a point — e.g. a heel driving into a target. ' +
      'anchor = where the force originates; relation.toward/away_from = the role it drives into or away from.',
  },
  pressure: {
    anchors: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'Concentrated downward/into contact pressure at a single point (a pin, a chest bearing down). ' +
      'anchor = the contact point. No direction.',
  },
  counter: {
    anchors: 1,
    relation: { requirement: 'required', kinds: ['toward', 'away_from'] },
    describe:
      "The OPPONENT's force being blocked/checked. anchor = where you block it; " +
      "relation.toward/away_from = the direction their force is trying to go (rendered blocked).",
  },
  base: {
    anchors: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'A base / support / post point that keeps you stable. anchor = the posting limb or point. No direction.',
  },
  grip: {
    anchors: 2,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'A grip / grab connecting two points — anchor = [the gripping hand, the gripped target]. No direction.',
  },
  frame: {
    anchors: 1,
    relation: { requirement: 'optional', kinds: ['away_from'] },
    describe:
      'A rigid strut/frame that holds distance. anchor = the framing limb; ' +
      'relation.away_from = what it holds off (optional).',
  },
  rotation: {
    anchors: 1,
    relation: { requirement: 'required', kinds: ['around'] },
    describe:
      'A rotational/turning action. anchor = what turns; relation.around = the pivot role it turns about.',
  },
  'weight-distribution': {
    anchors: 1,
    relation: { requirement: 'none', kinds: [] },
    describe:
      'Where body weight is settled/loaded. anchor = the point weight bears through. No direction.',
  },
  'movement-path': {
    anchors: 1,
    relation: { requirement: 'required', kinds: ['toward'] },
    describe:
      'A path a limb/body should travel. anchor = what moves; relation.toward = the destination role.',
  },
};

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES);

// ── Validation ──────────────────────────────────────────────────────────────
// Rejects unknown primitives, unknown roles, wrong arity, and missing/illegal
// relations. `knownRoles` comes from the target position's role map — the spec
// is only valid AGAINST a specific position.

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function relationEntry(
  rel: Relation | undefined,
): { kind: RelationKind; role: string } | null {
  if (!rel) return null;
  if ('toward' in rel) return { kind: 'toward', role: rel.toward };
  if ('away_from' in rel) return { kind: 'away_from', role: rel.away_from };
  if ('around' in rel) return { kind: 'around', role: rel.around };
  return null;
}

export function validateSpec(
  spec: Spec,
  knownRoles: Set<string>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (spec.specVersion !== SPEC_VERSION)
    warnings.push(
      `specVersion ${spec.specVersion} != harness SPEC_VERSION ${SPEC_VERSION}`,
    );
  if (!Array.isArray(spec.annotations) || spec.annotations.length === 0)
    errors.push('spec has no annotations');
  if (spec.annotations && spec.annotations.length > MAX_ANNOTATIONS)
    warnings.push(
      `${spec.annotations.length} annotations exceeds soft cap of ${MAX_ANNOTATIONS}`,
    );

  const checkRole = (role: string, where: string) => {
    if (!knownRoles.has(role))
      errors.push(`${where}: unknown role "${role}"`);
  };

  (spec.annotations ?? []).forEach((a, i) => {
    const where = `annotation[${i}] (${a.type})`;
    const prim = PRIMITIVES[a.type];
    if (!prim) {
      errors.push(`${where}: unknown primitive type "${a.type}"`);
      return;
    }

    const anchors = Array.isArray(a.anchor) ? a.anchor : [a.anchor];
    if (anchors.length !== prim.anchors)
      errors.push(
        `${where}: expected ${prim.anchors} anchor role(s), got ${anchors.length}`,
      );
    anchors.forEach((r) => checkRole(r, `${where}.anchor`));

    const rel = relationEntry(a.relation);
    if (prim.relation.requirement === 'required' && !rel)
      errors.push(`${where}: relation is required for this primitive`);
    if (prim.relation.requirement === 'none' && rel)
      errors.push(`${where}: this primitive takes no relation`);
    if (rel) {
      if (!prim.relation.kinds.includes(rel.kind))
        errors.push(
          `${where}: relation "${rel.kind}" not allowed (allowed: ${prim.relation.kinds.join(', ') || 'none'})`,
        );
      checkRole(rel.role, `${where}.relation`);
    }

    if (a.intensity && !['low', 'medium', 'high'].includes(a.intensity))
      errors.push(`${where}: invalid intensity "${a.intensity}"`);
  });

  return { valid: errors.length === 0, errors, warnings };
}

// A compact, LLM-facing description of the whole grammar (names, arity,
// relation rules, one-liners). Injected into the spec prompt.
export function describeGrammar(): string {
  return PRIMITIVE_NAMES.map((name) => {
    const p = PRIMITIVES[name];
    const rel =
      p.relation.requirement === 'none'
        ? 'no relation'
        : `relation ${p.relation.requirement} (${p.relation.kinds.join('|')})`;
    const arity = p.anchors === 1 ? '1 anchor role' : `${p.anchors} anchor roles`;
    return `- ${name} — ${arity}, ${rel}. ${p.describe}`;
  }).join('\n');
}
