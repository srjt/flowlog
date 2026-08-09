// #18 harness — the KEYPOINT model (implements #17 resolution point 1).
//
// Two layers:
//   1. skeleton  — per-person joints (both people), geometric only.
//   2. roles     — a per-position semantic role map aliasing role names to a
//                  joint, a derived point (midpoint / lerp), or an explicit
//                  contact point. The spec references roles; the renderer
//                  resolves them to coordinates here.
//
// Coordinates are normalized [0,1] over a fixed LANDSCAPE canvas (#17 point 4).
// Forward-compatible with the video horizon: detected joints would slot into
// the skeleton layer untouched, roles re-resolve for free.

export const CANVAS_W = 820;
export const CANVAS_H = 520;

/** Normalized point, each component in [0,1]. */
export type Vec = [number, number];

export interface Person {
  /** joint name -> normalized [0,1] point. */
  joints: Record<string, Vec>;
  /** bone segments as [jointA, jointB] pairs (polyline skin). */
  bones: [string, string][];
  /** joint drawn as the head circle. */
  head: string;
  /**
   * Optional foot orientation, keyed by ankle/foot joint name -> the toe point
   * it points at (normalized). Toe direction is authored, not derived from the
   * shin — in BJJ it's independent of the leg (a pointed vs flexed foot). The
   * fleshed skin draws a directional foot from the ankle toward the toe; the
   * stickman skin ignores it.
   */
  feet?: Record<string, { toe: Vec }>;
}

/**
 * A role resolves to a point via exactly one strategy:
 *   joint    "you.hip"                    — a skeleton joint
 *   midpoint ["opp.hip", "opp.knee"]      — halfway between two joints
 *   lerp     { between:["a","b"], t:0.4 } — parametric along a segment
 *   point    [0.72, 0.59]                 — an explicit contact/derived point
 */
export type RoleDef =
  | { joint: string }
  | { midpoint: [string, string] }
  | { lerp: { between: [string, string]; t: number } }
  | { point: Vec };

export interface Position {
  /** canonical base id (matches Spec.base). */
  id: string;
  label: string;
  /** the two people; keys are the person ids used in joint refs. */
  people: Record<string, Person>;
  /** semantic role map — role name -> how to resolve it. */
  roles: Record<string, RoleDef>;
}

// ── Resolution ──────────────────────────────────────────────────────────────

function joint(pos: Position, ref: string): Vec {
  const dot = ref.indexOf('.');
  if (dot === -1)
    throw new Error(`joint ref "${ref}" must be "person.joint"`);
  const person = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  const p = pos.people[person];
  if (!p) throw new Error(`unknown person "${person}" in ref "${ref}"`);
  const v = p.joints[name];
  if (!v) throw new Error(`unknown joint "${name}" on "${person}"`);
  return v;
}

function mid(a: Vec, b: Vec): Vec {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Resolve a semantic role to a normalized point. */
export function resolveRole(pos: Position, role: string): Vec {
  const def = pos.roles[role];
  if (!def) throw new Error(`unknown role "${role}" in position "${pos.id}"`);
  if ('joint' in def) return joint(pos, def.joint);
  if ('point' in def) return def.point;
  if ('midpoint' in def)
    return mid(joint(pos, def.midpoint[0]), joint(pos, def.midpoint[1]));
  if ('lerp' in def) {
    const a = joint(pos, def.lerp.between[0]);
    const b = joint(pos, def.lerp.between[1]);
    const t = def.lerp.t;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  throw new Error(`role "${role}" has no valid resolution strategy`);
}

/** All role names declared by a position (the validator's knownRoles set). */
export function roleNames(pos: Position): Set<string> {
  return new Set(Object.keys(pos.roles));
}

/** Normalized [0,1] -> canvas pixels. */
export function toPx(v: Vec): Vec {
  return [v[0] * CANVAS_W, v[1] * CANVAS_H];
}
