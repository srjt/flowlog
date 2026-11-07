/**
 * Force-diagram spec VALIDATION: the never-misleading floor, enforced in code.
 *
 * A spec is only valid AGAINST a specific base: its roles must exist on that
 * base and resolve to real points. Anything the validator cannot vouch for is
 * rejected whole and the caller shows the cue as text alone. Dropping only the
 * bad annotation would draw part of a mechanic — a heel driving nowhere, a
 * block with nothing to block — which can mislead more than no picture.
 *
 * `validateSpec` never throws. It accepts `unknown` (model output, a stored
 * row) and returns either a normalized `ValidatedSpec` or the full error list.
 *
 * Dependency-free on purpose (relative `.ts` imports only) so the edge
 * function can import it like `src/sports/*`.
 */

import {
  INTENSITIES,
  MAX_ANNOTATIONS,
  PRIMITIVES,
  RELATION_KINDS,
  SPEC_VERSION,
  isPrimitiveName,
} from './grammar.ts';
import type {
  Annotation,
  Intensity,
  PrimitiveName,
  Relation,
  RelationKind,
  Spec,
} from './grammar.ts';
import { parseBase, resolveRole, toPx } from './keypoints.ts';
import type { DiagramBase, Vec } from './keypoints.ts';

/**
 * A spec that passed `validateSpec`. The brand exists only in the type system
 * (nothing at runtime), so the renderer cannot be handed a raw model response
 * or a stored row that skipped validation. It does not survive JSON: a stored
 * spec is re-validated against the base it is drawn on, which is also what
 * keeps history honest when the base library changes.
 */
export type ValidatedSpec = Spec & {
  readonly __validated: 'force-diagram-spec';
};

export type SpecValidation =
  | { ok: true; spec: ValidatedSpec; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Two roles closer than this (canvas px) are one point. A direction between
 * them has no defined angle — the prototype drew a zero-length, invisible
 * arrow — and a grip between them connects a point to itself.
 */
export const COINCIDENT_PX = 1;

const SPEC_KEYS = ['specVersion', 'base', 'annotations'];
const ANNOTATION_KEYS = ['type', 'anchor', 'relation', 'intensity'];

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const show = (v: unknown): string =>
  typeof v === 'string' ? `"${v}"` : Array.isArray(v) ? 'an array' : typeof v;

type ParsedRelation =
  | { state: 'absent' }
  | { state: 'illegal'; error: string }
  | { state: 'present'; kind: RelationKind; role: unknown };

/**
 * Read a relation. `undefined`, `null` and `{}` all mean "no relation" — an
 * empty object carries no direction, and structured-output models emit it for
 * primitives that take none. Anything else must name exactly ONE kind: the
 * prototype silently took the first of `{ toward, away_from }`, so the drawn
 * direction depended on key order.
 */
function parseRelation(raw: unknown): ParsedRelation {
  if (raw === undefined || raw === null) return { state: 'absent' };
  if (!isRecord(raw))
    return { state: 'illegal', error: 'relation must be an object' };
  const keys = Object.keys(raw);
  if (keys.length === 0) return { state: 'absent' };
  if (keys.length > 1)
    return {
      state: 'illegal',
      error: `relation must name exactly one of ${RELATION_KINDS.join(' | ')}, got ${keys.join(', ')}`,
    };
  const kind = keys[0] as string;
  if (!(RELATION_KINDS as readonly string[]).includes(kind))
    return { state: 'illegal', error: `unknown relation "${kind}"` };
  return { state: 'present', kind: kind as RelationKind, role: raw[kind] };
}

function validateAnnotation(
  raw: unknown,
  index: number,
  base: DiagramBase,
  errors: string[],
  warnings: string[],
): Annotation | null {
  const where = `annotations[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${where}: not an object`);
    return null;
  }
  for (const key of Object.keys(raw))
    if (!ANNOTATION_KEYS.includes(key))
      warnings.push(`${where}: ignored unknown field "${key}"`);

  if (!isPrimitiveName(raw.type)) {
    errors.push(`${where}: unknown primitive ${show(raw.type)}`);
    return null;
  }
  const type: PrimitiveName = raw.type;
  const prim = PRIMITIVES[type];
  const at = `${where} (${type})`;
  const before = errors.length;

  // Resolve a role reference to canvas px, recording why when it cannot be.
  const point = (role: unknown, field: string): Vec | null => {
    if (typeof role !== 'string') {
      errors.push(`${at}.${field}: role must be a string, got ${show(role)}`);
      return null;
    }
    if (!hasOwn(base.roles, role)) {
      errors.push(`${at}.${field}: unknown role "${role}"`);
      return null;
    }
    const v = resolveRole(base, role);
    if (!v) {
      errors.push(`${at}.${field}: role "${role}" does not resolve`);
      return null;
    }
    return toPx(v);
  };
  const coincident = (a: Vec, b: Vec) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < COINCIDENT_PX;

  // ── anchor (arity) ──
  const anchors: unknown[] = Array.isArray(raw.anchor)
    ? raw.anchor
    : raw.anchor === undefined || raw.anchor === null
      ? []
      : [raw.anchor];
  const anchorPts: (Vec | null)[] = [];
  if (anchors.length !== prim.arity)
    errors.push(
      `${at}: expected ${prim.arity} anchor role(s), got ${anchors.length}`,
    );
  else anchors.forEach((r) => anchorPts.push(point(r, 'anchor')));

  const [a0, a1] = anchorPts;
  if (prim.arity === 2 && a0 && a1 && coincident(a0, a1))
    errors.push(`${at}: both anchors are the same point`);

  // ── relation ──
  const rel = parseRelation(raw.relation);
  let relation: Relation | undefined;
  if (rel.state === 'illegal') errors.push(`${at}: ${rel.error}`);
  else if (rel.state === 'absent') {
    if (prim.relation.requirement === 'required')
      errors.push(`${at}: relation is required for this primitive`);
  } else if (prim.relation.requirement === 'none')
    errors.push(`${at}: this primitive takes no relation`);
  else if (!prim.relation.kinds.includes(rel.kind))
    errors.push(
      `${at}: relation "${rel.kind}" not allowed (allowed: ${prim.relation.kinds.join(', ')})`,
    );
  else {
    const target = point(rel.role, `relation.${rel.kind}`);
    if (target && a0 && coincident(a0, target))
      errors.push(
        `${at}: relation names the anchor's own point, so there is no direction to draw`,
      );
    relation = { [rel.kind]: rel.role } as Relation;
  }

  // ── intensity ──
  let intensity: Intensity | undefined;
  if (raw.intensity !== undefined && raw.intensity !== null) {
    if ((INTENSITIES as readonly unknown[]).includes(raw.intensity))
      intensity = raw.intensity as Intensity;
    else errors.push(`${at}: invalid intensity ${show(raw.intensity)}`);
  }

  if (errors.length > before) return null;

  const roles = anchors as string[];
  const out: Annotation = {
    type,
    anchor:
      prim.arity === 1
        ? (roles[0] as string)
        : [roles[0] as string, roles[1] as string],
  };
  if (relation) out.relation = relation;
  if (intensity) out.intensity = intensity;
  return out;
}

/**
 * Validate a spec against a base. Rejects: a non-object spec; the wrong
 * `specVersion`; a spec for another base; no annotations; an unknown
 * primitive; an unknown or unresolvable role; the wrong anchor arity; a
 * missing, extra, multi-kind or illegal relation; a direction or grip between
 * coincident points; an invalid intensity.
 *
 * Over-long specs are truncated to `MAX_ANNOTATIONS` (the soft cap) with a
 * warning, and only the kept annotations are validated: the tail is never
 * drawn. Unknown fields are dropped with a warning. The returned spec is a
 * clean copy — single anchors as strings, grips as `[hand, target]`.
 */
export function validateSpec(
  input: unknown,
  base: DiagramBase,
): SpecValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const parsed = parseBase(base);
    if (!parsed.ok)
      return {
        ok: false,
        errors: parsed.errors.map((e) => `base: ${e}`),
        warnings,
      };
    const b = parsed.base;

    if (!isRecord(input))
      return { ok: false, errors: ['spec is not an object'], warnings };
    for (const key of Object.keys(input))
      if (!SPEC_KEYS.includes(key))
        warnings.push(`ignored unknown field "${key}"`);

    if (input.specVersion !== SPEC_VERSION)
      errors.push(
        `specVersion must be ${SPEC_VERSION}, got ${show(input.specVersion)}`,
      );
    if (input.base !== b.id)
      errors.push(`spec is for base ${show(input.base)}, not "${b.id}"`);

    let list: unknown[] = [];
    if (!Array.isArray(input.annotations))
      errors.push('annotations: not an array');
    else if (input.annotations.length === 0)
      errors.push('annotations: empty, nothing to draw');
    else list = input.annotations;

    if (list.length > MAX_ANNOTATIONS) {
      warnings.push(
        `${list.length} annotations exceed the soft cap of ${MAX_ANNOTATIONS}; drew the first ${MAX_ANNOTATIONS}`,
      );
      list = list.slice(0, MAX_ANNOTATIONS);
    }

    const annotations: Annotation[] = [];
    list.forEach((raw, i) => {
      const a = validateAnnotation(raw, i, b, errors, warnings);
      if (a) annotations.push(a);
    });

    if (errors.length > 0) return { ok: false, errors, warnings };
    const spec = {
      specVersion: SPEC_VERSION,
      base: b.id,
      annotations,
    } as ValidatedSpec;
    return { ok: true, spec, warnings };
  } catch {
    // Exotic input (a throwing getter, a proxy). Never let it reach the caller.
    return {
      ok: false,
      errors: [...errors, 'spec could not be read'],
      warnings,
    };
  }
}
