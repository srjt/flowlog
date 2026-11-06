/**
 * Force-diagram KEYPOINT model (#135, from the #17 domain model / #18
 * prototype).
 *
 * A diagram base is two layers over a fixed landscape canvas:
 *
 *   1. skeleton — both players' joints + bones, normalized [0,1] coordinates.
 *      Purely geometric; a detected skeleton (the video horizon) would slot in
 *      here untouched.
 *   2. roles    — a semantic role map aliasing a role name to a joint, a
 *      derived point (midpoint / lerp between two joints), or an explicit
 *      contact point. A contact point decouples a contact (heel on hamstring)
 *      from an occluded joint (the foot behind the leg).
 *
 * Specs only ever reference ROLES; this module resolves them to coordinates.
 *
 * Role naming convention (kept from the prototype, where it took the spec
 * model to zero unknown-role errors): `your_*` names a point on the
 * practitioner's body, `opp_*` one on the opponent's. Names without either
 * prefix are limbs or contacts whose owner the name makes plain
 * (`hook_heel`, `heel_on_hamstring`). Role names are snake_case because they
 * are handed to the model verbatim as an enum.
 *
 * Dependency-free on purpose (relative `.ts` imports only, no `@/`, node or
 * React Native) so the edge function can import it like `src/sports/*`.
 */

/** The fixed canvas every base is normalized over. */
export const CANVAS_W = 820;
export const CANVAS_H = 520;

/** A point. Normalized [0,1] in a base; canvas pixels after `toPx`. */
export type Vec = [number, number];

/** The two figures. `you` is the practitioner the cue is for. */
export const PERSON_IDS = ['you', 'opp'] as const;
export type PersonId = (typeof PERSON_IDS)[number];

export interface Person {
  /** joint name -> normalized point. */
  joints: Record<string, Vec>;
  /** Bone segments as [jointA, jointB]. */
  bones: [string, string][];
  /** The joint drawn as the head. */
  head: string;
  /**
   * Authored foot orientation: ankle/foot joint -> the toe point it points at.
   * Authored rather than derived from the shin, because a pointed and a flexed
   * foot sit on the same leg. Only the fleshed skin draws it.
   */
  feet?: Record<string, { toe: Vec }>;
}

/**
 * How a role resolves. Joint references are `"person.joint"`.
 *
 *   { joint: "you.hip" }                          a skeleton joint
 *   { midpoint: ["opp.hip", "opp.l_knee"] }       halfway between two joints
 *   { lerp: { between: ["a", "b"], t: 0.4 } }     a fraction along a segment
 *   { point: [0.72, 0.59] }                       an explicit contact point
 */
export type RoleDef =
  | { joint: string }
  | { midpoint: [string, string] }
  | { lerp: { between: [string, string]; t: number } }
  | { point: Vec };

export interface DiagramBase {
  /** Base id. A spec's `base` must equal it. */
  id: string;
  label: string;
  /** Camera view (`side`, `top`, ...): a base is really (position, view). */
  view?: string;
  people: Record<PersonId, Person>;
  /** Semantic role map: role name -> how to resolve it. */
  roles: Record<string, RoleDef>;
}

const hasOwn = (o: object, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const ROLE_NAME = /^[a-z][a-z0-9_]*$/;

// ── Resolution ──────────────────────────────────────────────────────────────

function jointAt(base: DiagramBase, ref: string): Vec | null {
  const dot = ref.indexOf('.');
  if (dot === -1) return null;
  const personId = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  if (!hasOwn(base.people, personId)) return null;
  const person = base.people[personId as PersonId];
  if (!hasOwn(person.joints, name)) return null;
  return person.joints[name] ?? null;
}

const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/**
 * Resolve a role to its normalized point, or `null` when the base has no such
 * role (or the role points at a joint that does not exist). Never throws.
 */
export function resolveRole(base: DiagramBase, role: string): Vec | null {
  if (typeof role !== 'string' || !hasOwn(base.roles, role)) return null;
  const def = base.roles[role];
  if (!def) return null;
  if ('joint' in def) return jointAt(base, def.joint);
  if ('point' in def) return [def.point[0], def.point[1]];
  if ('midpoint' in def) {
    const a = jointAt(base, def.midpoint[0]);
    const b = jointAt(base, def.midpoint[1]);
    return a && b ? lerp(a, b, 0.5) : null;
  }
  if ('lerp' in def) {
    const a = jointAt(base, def.lerp.between[0]);
    const b = jointAt(base, def.lerp.between[1]);
    return a && b ? lerp(a, b, def.lerp.t) : null;
  }
  return null;
}

/** Every role a base declares — the closed enum a spec may reference. */
export function roleNames(base: DiagramBase): string[] {
  return Object.keys(base.roles);
}

/** Normalized [0,1] -> canvas pixels. */
export function toPx(v: Vec): Vec {
  return [v[0] * CANVAS_W, v[1] * CANVAS_H];
}

// ── Structural validation ───────────────────────────────────────────────────
// Bases are authored data (eventually exported by a posing tool). A broken one
// — a bone to a missing joint, a role to nowhere, a point off the canvas —
// would draw a partial or wrong figure, which is exactly what the
// never-misleading floor forbids. So every base passes through `parseBase`
// before a spec is validated or rendered against it.

export type BaseParse =
  | { ok: true; base: DiagramBase }
  | { ok: false; errors: string[] };

function parseVec(v: unknown): Vec | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [x, y] = v as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}

function parsePair(v: unknown): [string, string] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = v as unknown[];
  return typeof a === 'string' && typeof b === 'string' ? [a, b] : null;
}

function parsePerson(
  id: string,
  input: unknown,
  errors: string[],
): Person | null {
  const where = `people.${id}`;
  if (!isRecord(input)) {
    errors.push(`${where}: missing or not an object`);
    return null;
  }
  const joints: Record<string, Vec> = {};
  if (!isRecord(input.joints) || Object.keys(input.joints).length === 0) {
    errors.push(`${where}.joints: missing or empty`);
    return null;
  }
  for (const [name, raw] of Object.entries(input.joints)) {
    const v = parseVec(raw);
    if (!v) errors.push(`${where}.joints.${name}: not a normalized [x, y]`);
    else joints[name] = v;
  }
  const has = (name: string) => hasOwn(joints, name);

  const bones: [string, string][] = [];
  if (!Array.isArray(input.bones)) errors.push(`${where}.bones: not an array`);
  else
    input.bones.forEach((raw, i) => {
      const pair = parsePair(raw);
      if (!pair) errors.push(`${where}.bones[${i}]: not a [joint, joint] pair`);
      else if (!has(pair[0]) || !has(pair[1]))
        errors.push(`${where}.bones[${i}]: references a missing joint`);
      else bones.push(pair);
    });

  const head = input.head;
  if (typeof head !== 'string' || !has(head))
    errors.push(`${where}.head: not one of the person's joints`);

  let feet: Person['feet'];
  if (input.feet !== undefined) {
    if (!isRecord(input.feet)) errors.push(`${where}.feet: not an object`);
    else {
      feet = {};
      for (const [name, raw] of Object.entries(input.feet)) {
        const toe = isRecord(raw) ? parseVec(raw.toe) : null;
        if (!has(name))
          errors.push(`${where}.feet.${name}: not one of the person's joints`);
        else if (!toe)
          errors.push(`${where}.feet.${name}.toe: not a normalized [x, y]`);
        else feet[name] = { toe };
      }
    }
  }

  const person: Person = { joints, bones, head: String(head) };
  if (feet) person.feet = feet;
  return person;
}

function jointRefOk(
  people: Partial<Record<PersonId, Person>>,
  ref: unknown,
): ref is string {
  if (typeof ref !== 'string') return false;
  const dot = ref.indexOf('.');
  if (dot === -1) return false;
  const personId = ref.slice(0, dot);
  const person = hasOwn(people, personId)
    ? people[personId as PersonId]
    : undefined;
  return !!person && hasOwn(person.joints, ref.slice(dot + 1));
}

function parseRole(
  name: string,
  raw: unknown,
  people: Partial<Record<PersonId, Person>>,
  errors: string[],
): RoleDef | null {
  const where = `roles.${name}`;
  if (!ROLE_NAME.test(name)) {
    errors.push(`${where}: role names must be snake_case`);
    return null;
  }
  if (!isRecord(raw)) {
    errors.push(`${where}: not an object`);
    return null;
  }
  const strategies = ['joint', 'midpoint', 'lerp', 'point'].filter((k) =>
    hasOwn(raw, k),
  );
  if (strategies.length !== 1) {
    errors.push(
      `${where}: needs exactly one of joint | midpoint | lerp | point`,
    );
    return null;
  }
  const bad = (msg: string) => {
    errors.push(`${where}: ${msg}`);
    return null;
  };
  switch (strategies[0]) {
    case 'joint':
      return jointRefOk(people, raw.joint)
        ? { joint: raw.joint }
        : bad('joint does not exist');
    case 'midpoint': {
      const pair = parsePair(raw.midpoint);
      return pair && jointRefOk(people, pair[0]) && jointRefOk(people, pair[1])
        ? { midpoint: pair }
        : bad('midpoint needs two existing joints');
    }
    case 'lerp': {
      const l = isRecord(raw.lerp) ? raw.lerp : {};
      const pair = parsePair(l.between);
      const t = l.t;
      if (!pair || !jointRefOk(people, pair[0]) || !jointRefOk(people, pair[1]))
        return bad('lerp needs two existing joints');
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 1)
        return bad('lerp.t must be within [0, 1]');
      return { lerp: { between: pair, t } };
    }
    default: {
      const v = parseVec(raw.point);
      return v ? { point: v } : bad('point is not a normalized [x, y]');
    }
  }
}

/**
 * Structurally validate an authored base and return a clean, typed copy (only
 * known fields survive). Never throws: an unusable base yields `ok: false`
 * with every problem listed, so a caller treats it as "no diagram".
 */
export function parseBase(input: unknown): BaseParse {
  const errors: string[] = [];
  try {
    if (!isRecord(input))
      return { ok: false, errors: ['base is not an object'] };
    const id = input.id;
    const label = input.label;
    if (typeof id !== 'string' || id.length === 0)
      errors.push('id: missing or empty');
    if (typeof label !== 'string' || label.length === 0)
      errors.push('label: missing or empty');
    if (input.view !== undefined && typeof input.view !== 'string')
      errors.push('view: not a string');

    const people: Partial<Record<PersonId, Person>> = {};
    if (!isRecord(input.people))
      errors.push('people: missing or not an object');
    else {
      for (const key of Object.keys(input.people))
        if (!(PERSON_IDS as readonly string[]).includes(key))
          errors.push(`people.${key}: only "you" and "opp" are drawn`);
      for (const pid of PERSON_IDS) {
        const p = parsePerson(pid, input.people[pid], errors);
        if (p) people[pid] = p;
      }
    }

    const roles: Record<string, RoleDef> = {};
    if (!isRecord(input.roles) || Object.keys(input.roles).length === 0)
      errors.push('roles: missing or empty');
    else
      for (const [name, raw] of Object.entries(input.roles)) {
        const def = parseRole(name, raw, people, errors);
        if (def) roles[name] = def;
      }

    if (errors.length > 0 || !people.you || !people.opp)
      return { ok: false, errors };
    const base: DiagramBase = {
      id: String(id),
      label: String(label),
      people: { you: people.you, opp: people.opp },
      roles,
    };
    if (typeof input.view === 'string') base.view = input.view;
    return { ok: true, base };
  } catch {
    // Exotic input (a throwing getter, a proxy). Not a usable base.
    return { ok: false, errors: [...errors, 'base could not be read'] };
  }
}
