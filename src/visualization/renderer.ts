/**
 * Deterministic force-diagram RENDERER (#135, ported from the #18 prototype).
 *
 * (base, spec) -> an SVG element tree + its serialized string. Nothing is
 * generated: every coloured mark comes from resolving an annotation's roles to
 * coordinates and running a fixed per-primitive draw routine over a
 * deterministic skin of the base's keypoints. Grey = the figures; colour = the
 * overlay.
 *
 * STATIC-COMPLETE. The output reads fully with no stylesheet and no motion:
 * colours are concrete values from a palette (the prototype used CSS `var()`s
 * that drew nothing outside its gallery page, and left the pressure discs fully
 * opaque without its keyframes), arrowheads are plain polygons (no `<marker>`
 * ids to collide when several diagrams share a page), and there is no
 * `<style>`.
 *
 * ANIMATION IS ADDITIVE, as data only. Nodes that a future component may move
 * carry `data-fd-anim` (and, for directional motion, `data-fd-dir`, the unit
 * direction in canvas px). Under reduced motion, or in a list, the component
 * simply ignores them. Hooks:
 *   drive  — a force mark nudging along `data-fd-dir`
 *   shove  — a countered force pushing along `data-fd-dir` and being stopped
 *   flow   — dashes travelling along a line (force shaft, movement path)
 *   pulse  — a pressure core breathing in place
 *   halo   — a pressure halo breathing in place
 *
 * Every annotation is one `<g data-fd-annotation="i" data-fd-type="…">`, in
 * spec order, with its label as `<text data-fd-label="i">`, so a reader can
 * always map a mark back to the spec.
 *
 * Never throws: `renderForceDiagram` returns `{ ok: false, errors }` for an
 * unusable base or spec, and the caller shows the cue as text alone.
 *
 * Dependency-free on purpose (relative `.ts` imports only; no React Native, no
 * `react-native-svg`).
 */

import { anchorRoles, relationOf } from './grammar.ts';
import type { Annotation, PrimitiveName } from './grammar.ts';
import {
  CANVAS_H,
  CANVAS_W,
  parseBase,
  resolveRole,
  toPx,
} from './keypoints.ts';
import type { DiagramBase, Person, Vec } from './keypoints.ts';
import { el, num, serializeSvg } from './svg.ts';
import type { SvgElement } from './svg.ts';
import { validateSpec } from './validateSpec.ts';
import type { ValidatedSpec } from './validateSpec.ts';

export type Skin = 'stickman' | 'fleshed';

export type AnimationHook = 'drive' | 'shove' | 'flow' | 'pulse' | 'halo';

export interface DiagramPalette {
  /** Background, and the light dashes inside a force shaft. */
  surface: string;
  mat: string;
  /** Secondary text: captions, the counter label. */
  muted: string;
  you: string;
  opp: string;
  /** One overlay colour per primitive. */
  marks: Record<PrimitiveName, string>;
}

// The #18 gallery's palette, resolved to concrete values.
export const LIGHT_PALETTE: DiagramPalette = {
  surface: '#faf9f7',
  mat: '#d8d2c6',
  muted: '#6a7078',
  you: '#565b63',
  opp: '#9aa0a8',
  marks: {
    force: '#dd6427',
    rotation: '#c94f8a',
    pressure: '#dd6427',
    frame: '#7b61c9',
    base: '#2f77d6',
    counter: '#9aa0a6',
    grip: '#2f9e6d',
    'weight-distribution': '#b58a1f',
    'movement-path': '#3f9bd0',
  },
};

export const DARK_PALETTE: DiagramPalette = {
  surface: '#17181b',
  mat: '#35373c',
  muted: '#9aa0a8',
  you: '#c6ccd4',
  opp: '#7f858d',
  marks: {
    force: '#ff8a4c',
    rotation: '#ef7bb2',
    pressure: '#ff8a4c',
    frame: '#a58bf0',
    base: '#64a2f5',
    counter: '#737980',
    grip: '#46c088',
    'weight-distribution': '#d9b64a',
    'movement-path': '#6cc0ef',
  },
};

export interface RenderOptions {
  /** Base skin (default `stickman`). Both draw the same keypoints. */
  skin?: Skin;
  palette?: DiagramPalette;
  /** Accessible name. The client passes the cue text; defaults to the base label. */
  title?: string;
}

export type RenderResult =
  | {
      ok: true;
      svg: string;
      tree: SvgElement;
      spec: ValidatedSpec;
      warnings: string[];
    }
  | { ok: false; errors: string[]; warnings: string[] };

// ── px vector helpers ───────────────────────────────────────────────────────
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const len = (a: Vec): number => Math.hypot(a[0], a[1]);
const unit = (a: Vec): Vec => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: Vec): Vec => [-a[1], a[0]];
const pts = (ps: Vec[]): string =>
  ps.map((p) => `${num(p[0])},${num(p[1])}`).join(' ');
const dirAttr = (d: Vec): string => `${num(d[0])},${num(d[1])}`;

const FONT = 'ui-sans-serif, system-ui, sans-serif';

const INTENSITY = { low: 0.62, medium: 0.8, high: 1 } as const;
const intensityOf = (a: Annotation): number =>
  INTENSITY[a.intensity ?? 'medium'];

// Rotation arc: a fixed arc LENGTH through the anchor, so a far pivot draws a
// short, local arc instead of sweeping off the canvas.
const ROTATION_ARC_PX = 120;
const ROTATION_MAX_SWEEP = 2.1; // rad, ~120°
const ROTATION_MIN_RADIUS = 26;

/** Turn a role id into a label fragment, per the your_* / opp_* convention. */
function humanize(role: string): string {
  return role
    .replace(/^opp_/, "opponent's ")
    .replace(/^(you_|your_)/, 'your ')
    .replace(/_/g, ' ');
}

interface Label {
  at: Vec;
  text: string;
  color: string;
  /**
   * Which way the text should run from `at`, so it extends AWAY from its own
   * mark instead of across it. Omitted = centred.
   */
  away?: Vec;
}

type TextAnchor = 'start' | 'middle' | 'end';

const anchorFor = (away: Vec | undefined): TextAnchor =>
  !away || Math.abs(away[0]) < 0.5 ? 'middle' : away[0] > 0 ? 'start' : 'end';

// Approximate advance of the 12.5px semibold label face. Only used to keep a
// label wholly on the canvas; it need not be exact, only deterministic.
const LABEL_CHAR_W = 6.6;
interface Drawn {
  marks: SvgElement[];
  label: Label;
  /** Attributes for the annotation's group (animation hooks). */
  group?: Record<string, string>;
}
interface Ctx {
  base: DiagramBase;
  palette: DiagramPalette;
}

/** Canvas-px point of a role. Validated specs only ever name resolvable roles. */
function at(ctx: Ctx, role: string): Vec {
  const v = resolveRole(ctx.base, role);
  if (!v) throw new Error(`role "${role}" does not resolve`);
  return toPx(v);
}

const line = (a: Vec, b: Vec, attrs: Record<string, string>): SvgElement =>
  el('line', {
    x1: num(a[0]),
    y1: num(a[1]),
    x2: num(b[0]),
    y2: num(b[1]),
    ...attrs,
  });

const circle = (c: Vec, r: number, attrs: Record<string, string>): SvgElement =>
  el('circle', { cx: num(c[0]), cy: num(c[1]), r: num(r), ...attrs });

/** A notched arrowhead with its tip exactly at `tip`, pointing along `d`. */
function arrowHead(tip: Vec, d: Vec, size: number, color: string): SvgElement {
  const n = perp(d);
  const back = sub(tip, scale(d, size));
  const notch = sub(tip, scale(d, size * 0.7));
  return el('polygon', {
    points: pts([
      tip,
      add(back, scale(n, size / 2)),
      notch,
      sub(back, scale(n, size / 2)),
    ]),
    fill: color,
  });
}

// ── base skins ──────────────────────────────────────────────────────────────

function drawStickman(p: Person, color: string): SvgElement[] {
  const bones = p.bones.flatMap(([a, b]) => {
    const ja = p.joints[a];
    const jb = p.joints[b];
    return ja && jb ? [line(toPx(ja), toPx(jb), {})] : [];
  });
  const head = p.joints[p.head];
  return [
    el(
      'g',
      {
        fill: 'none',
        stroke: color,
        'stroke-width': '12',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      bones,
    ),
    ...(head ? [circle(toPx(head), 22, { fill: color })] : []),
  ];
}

// Limb thickness per joint, by keyword — joint names are authored per base, so
// there is no fixed joint set to key on.
function jointRadius(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('hip') || n.includes('pelvis') || n.includes('waist'))
    return 17;
  if (n.includes('chest')) return 16;
  if (n.includes('shoulder')) return 13;
  if (n.includes('neck')) return 12;
  if (n.includes('knee')) return 12;
  if (n.includes('foot') || n.includes('ankle') || n.includes('heel')) return 8;
  if (n.includes('elbow')) return 9;
  if (n.includes('hand') || n.includes('wrist')) return 7;
  return 10;
}

function limbQuad(a: Vec, ra: number, b: Vec, rb: number): SvgElement {
  const n = perp(unit(sub(b, a)));
  return el('polygon', {
    points: pts([
      add(a, scale(n, ra)),
      add(b, scale(n, rb)),
      sub(b, scale(n, rb)),
      sub(a, scale(n, ra)),
    ]),
  });
}

/** Volume-carrying figure over the SAME keypoints: tapered limbs, round joints, authored feet. */
function drawFleshed(p: Person, color: string): SvgElement[] {
  const limbs: SvgElement[] = [];
  for (const [a, b] of p.bones) {
    const ja = p.joints[a];
    const jb = p.joints[b];
    if (!ja || !jb) continue;
    const pa = toPx(ja);
    const pb = toPx(jb);
    const ra = jointRadius(a);
    const rb = jointRadius(b);
    limbs.push(
      limbQuad(pa, ra, pb, rb),
      circle(pa, ra, {}),
      circle(pb, rb, {}),
    );
  }
  const out: SvgElement[] = [el('g', { fill: color, stroke: 'none' }, limbs)];
  for (const [ankleName, foot] of Object.entries(p.feet ?? {})) {
    const ankle = p.joints[ankleName];
    if (!ankle) continue;
    const pa = toPx(ankle);
    out.push(
      line(pa, toPx(foot.toe), {
        stroke: color,
        'stroke-width': '15',
        'stroke-linecap': 'round',
      }),
      circle(pa, 9, { fill: color }),
    );
  }
  const head = p.joints[p.head];
  if (head) {
    const h = toPx(head);
    out.push(
      el('ellipse', {
        cx: num(h[0]),
        cy: num(h[1]),
        rx: '20',
        ry: '23',
        fill: color,
      }),
    );
  }
  return out;
}

// ── per-primitive draw routines ─────────────────────────────────────────────
// Each receives a VALIDATED annotation: arity and relation are guaranteed.

const anchorOf = (a: Annotation): string => anchorRoles(a)[0] as string;
const relationRole = (a: Annotation): string =>
  relationOf(a.relation)?.role ?? '';
const isAway = (a: Annotation): boolean =>
  relationOf(a.relation)?.kind === 'away_from';

function drawForce(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.force;
  const origin = at(ctx, anchorOf(a));
  const target = at(ctx, relationRole(a));
  const toward = unit(sub(target, origin));
  const d = isAway(a) ? scale(toward, -1) : toward;
  const k = intensityOf(a);
  const l = Math.min(95 * k, Math.max(44, len(sub(target, origin)) * 1.6));
  const tip = add(origin, scale(d, l));
  const head = 18;
  const shaftEnd = sub(tip, scale(d, head * 0.6));
  const role = humanize(relationRole(a));
  return {
    group: { 'data-fd-anim': 'drive', 'data-fd-dir': dirAttr(d) },
    marks: [
      line(origin, shaftEnd, {
        stroke: color,
        'stroke-width': num(4 + 2.5 * k),
        'stroke-linecap': 'round',
      }),
      arrowHead(tip, d, head, color),
      line(origin, shaftEnd, {
        stroke: ctx.palette.surface,
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        'stroke-dasharray': '3 13',
        opacity: '0.85',
        'data-fd-anim': 'flow',
      }),
    ],
    label: {
      at: add(add(origin, scale(d, l * 0.55)), scale(perp(d), -18)),
      // The prototype said "drive into" even when the arrow pointed away.
      text: isAway(a) ? `push away from ${role}` : `drive into ${role}`,
      color,
      away: scale(perp(d), -1),
    },
  };
}

/**
 * Rotation. Grammar v1 says WHAT turns and its PIVOT, but not which way, so
 * the arc is drawn symmetric about the anchor with a head at both ends rather
 * than inventing a sense of rotation. (The prototype always swept one way —
 * for the golden "drop your shoulder toward the mat" it swung the shoulder UP
 * and off the canvas.)
 */
function drawRotation(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.rotation;
  const pivot = at(ctx, relationRole(a));
  const anchor = at(ctx, anchorOf(a));
  const r = Math.max(ROTATION_MIN_RADIUS, len(sub(anchor, pivot)));
  const mid = Math.atan2(anchor[1] - pivot[1], anchor[0] - pivot[0]);
  const sweep = Math.min(ROTATION_MAX_SWEEP, ROTATION_ARC_PX / r);
  const s = mid - sweep / 2;
  const e = mid + sweep / 2;
  const on = (t: number): Vec => [
    pivot[0] + r * Math.cos(t),
    pivot[1] + r * Math.sin(t),
  ];
  const p0 = on(s);
  const p1 = on(e);
  // Direction of increasing angle at t (clockwise on screen, y down).
  const tangent = (t: number): Vec => [-Math.sin(t), Math.cos(t)];
  const apex = on(mid);
  const outward = unit(sub(apex, pivot));
  return {
    marks: [
      el('path', {
        d: `M ${num(p0[0])} ${num(p0[1])} A ${num(r)} ${num(r)} 0 0 1 ${num(p1[0])} ${num(p1[1])}`,
        fill: 'none',
        stroke: color,
        'stroke-width': '4.5',
        'stroke-linecap': 'round',
      }),
      arrowHead(p1, tangent(e), 15, color),
      arrowHead(p0, scale(tangent(s), -1), 15, color),
      circle(pivot, 9, { fill: 'none', stroke: color, 'stroke-width': '2.5' }),
      circle(pivot, 4, { fill: color }),
    ],
    label: {
      at: add(apex, scale(outward, 16)),
      text: `rotate around ${humanize(relationRole(a))}`,
      color,
      away: outward,
    },
  };
}

function drawPressure(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.pressure;
  const c = at(ctx, anchorOf(a));
  const k = intensityOf(a);
  return {
    marks: [
      circle(c, 34 * k, {
        fill: color,
        opacity: '0.2',
        'data-fd-anim': 'halo',
      }),
      circle(c, 13 * k, {
        fill: color,
        opacity: '0.45',
        'data-fd-anim': 'pulse',
      }),
    ],
    label: { at: add(c, [0, -46]), text: 'pressure', color },
  };
}

function drawFrame(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.frame;
  const anchor = at(ctx, anchorOf(a));
  const held = relationOf(a.relation)?.role;
  // The bracket's flat face meets what it holds off; its prongs point away.
  const dir: Vec = held ? scale(unit(sub(at(ctx, held), anchor)), -1) : [0, -1];
  const n = perp(dir);
  const barA = add(anchor, scale(n, 20));
  const barB = sub(anchor, scale(n, 20));
  return {
    marks: [
      el(
        'g',
        {
          stroke: color,
          'stroke-width': '5',
          'stroke-linecap': 'round',
          fill: 'none',
        },
        [
          line(barA, barB, {}),
          line(barA, add(barA, scale(dir, 16)), {}),
          line(barB, add(barB, scale(dir, 16)), {}),
        ],
      ),
    ],
    label: {
      at: add(anchor, scale(dir, 30)),
      text: held ? `frame off ${humanize(held)}` : 'frame',
      color,
      away: dir,
    },
  };
}

function drawBase(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.base;
  const c = at(ctx, anchorOf(a));
  return {
    marks: [
      circle(c, 13, { fill: 'none', stroke: color, 'stroke-width': '3' }),
      circle(c, 3.5, { fill: color }),
    ],
    label: { at: add(c, [0, 30]), text: 'base', color },
  };
}

function drawCounter(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.counter;
  const origin = at(ctx, anchorOf(a));
  const target = at(ctx, relationRole(a));
  const toward = unit(sub(target, origin));
  const d = isAway(a) ? scale(toward, -1) : toward;
  const tip = add(origin, scale(d, 66));
  const n = perp(d);
  // A block "X" partway along their force.
  const bx = add(origin, scale(d, 30));
  const bx2 = add(bx, scale(d, 12));
  return {
    group: { 'data-fd-anim': 'shove', 'data-fd-dir': dirAttr(d) },
    marks: [
      line(origin, sub(tip, scale(d, 9)), {
        stroke: color,
        'stroke-width': '4',
        'stroke-dasharray': '7 6',
      }),
      arrowHead(tip, d, 15, color),
      el(
        'g',
        { stroke: color, 'stroke-width': '3', 'stroke-linecap': 'round' },
        [
          line(add(bx, scale(n, 9)), sub(bx2, scale(n, 9)), {}),
          line(sub(bx, scale(n, 9)), add(bx2, scale(n, 9)), {}),
        ],
      ),
    ],
    label: {
      at: add(tip, scale(d, 10)),
      text: 'blocks their force',
      color: ctx.palette.muted,
      away: d,
    },
  };
}

function drawGrip(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks.grip;
  const [handRole, targetRole] = anchorRoles(a) as [string, string];
  const hand = at(ctx, handRole);
  const target = at(ctx, targetRole);
  return {
    marks: [
      line(hand, target, {
        stroke: color,
        'stroke-width': '3.5',
        'stroke-linecap': 'round',
      }),
      circle(target, 10, {
        fill: 'none',
        stroke: color,
        'stroke-width': '3.5',
      }),
      circle(hand, 5, { fill: color }),
    ],
    label: {
      at: add(target, [0, -18]),
      text: `grip ${humanize(targetRole)}`,
      color,
    },
  };
}

// The prototype computed round(2 + k) chevrons, which is 3 for every
// intensity; this makes intensity visible.
const CHEVRONS = { low: 1, medium: 2, high: 3 } as const;

function drawWeight(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks['weight-distribution'];
  const c = at(ctx, anchorOf(a));
  const rows = CHEVRONS[a.intensity ?? 'medium'];
  const chevrons: SvgElement[] = [];
  for (let i = 0; i < rows; i++) {
    const y = c[1] - 26 - i * 12;
    chevrons.push(
      el('polyline', {
        points: pts([
          [c[0] - 12, y],
          [c[0], y + 9],
          [c[0] + 12, y],
        ]),
        fill: 'none',
        stroke: color,
        'stroke-width': '3.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: num(0.5 + i * 0.2),
      }),
    );
  }
  return {
    marks: [...chevrons, circle(c, 6, { fill: color })],
    label: { at: add(c, [0, 22]), text: 'weight', color },
  };
}

function drawMovement(a: Annotation, ctx: Ctx): Drawn {
  const color = ctx.palette.marks['movement-path'];
  const origin = at(ctx, anchorOf(a));
  const target = at(ctx, relationRole(a));
  const d = unit(sub(target, origin));
  return {
    marks: [
      line(origin, sub(target, scale(d, 9)), {
        stroke: color,
        'stroke-width': '4',
        'stroke-linecap': 'round',
        'stroke-dasharray': '2 12',
        'data-fd-anim': 'flow',
      }),
      arrowHead(target, d, 15, color),
    ],
    label: {
      at: add(target, [0, -18]),
      text: `move to ${humanize(relationRole(a))}`,
      color,
    },
  };
}

const DRAWERS: Record<PrimitiveName, (a: Annotation, ctx: Ctx) => Drawn> = {
  force: drawForce,
  rotation: drawRotation,
  pressure: drawPressure,
  frame: drawFrame,
  base: drawBase,
  counter: drawCounter,
  grip: drawGrip,
  'weight-distribution': drawWeight,
  'movement-path': drawMovement,
};

// ── labels ──────────────────────────────────────────────────────────────────

/** Nudge labels apart vertically so marks clustered on one contact don't stack their text. */
function layoutLabels(labels: Label[]): Label[] {
  const placed = labels.map((l) => ({ ...l, at: [l.at[0], l.at[1]] as Vec }));
  const order = placed
    .map((l, i) => ({ l, i }))
    .sort((p, q) => p.l.at[1] - q.l.at[1] || p.i - q.i);
  let lastY = -Infinity;
  let lastX = 0;
  for (const { l } of order) {
    if (l.at[1] < lastY + 17 && Math.abs(l.at[0] - lastX) < 190)
      l.at = [l.at[0], lastY + 17];
    lastY = l.at[1];
    lastX = l.at[0];
  }
  return placed;
}

const text = (
  x: number,
  y: number,
  content: string,
  attrs: Record<string, string>,
): SvgElement =>
  el(
    'text',
    {
      x: num(x),
      y: num(y),
      'text-anchor': 'middle',
      'font-family': FONT,
      ...attrs,
    },
    [content],
  );

/**
 * A label element, kept wholly on the canvas. The prototype clamped only the
 * anchor point, so a centred label near an edge was cut off.
 */
function labelEl(l: Label, index: number): SvgElement {
  const anchor = anchorFor(l.away);
  const w = l.text.length * LABEL_CHAR_W;
  const pad = 6;
  const [lo, hi] =
    anchor === 'start'
      ? [pad, CANVAS_W - pad - w]
      : anchor === 'end'
        ? [pad + w, CANVAS_W - pad]
        : [pad + w / 2, CANVAS_W - pad - w / 2];
  return text(
    Math.max(lo, Math.min(hi, l.at[0])),
    Math.max(14, Math.min(CANVAS_H - 6, l.at[1])),
    l.text,
    {
      'text-anchor': anchor,
      'font-size': '12.5',
      'font-weight': '600',
      fill: l.color,
      'data-fd-label': String(index),
    },
  );
}

// ── entry point ─────────────────────────────────────────────────────────────

function buildTree(
  base: DiagramBase,
  spec: ValidatedSpec,
  opts: RenderOptions,
): SvgElement {
  const palette = opts.palette ?? LIGHT_PALETTE;
  const skin = opts.skin ?? 'stickman';
  const ctx: Ctx = { base, palette };
  const drawSkin = skin === 'fleshed' ? drawFleshed : drawStickman;
  const { you, opp } = base.people;

  const groups: SvgElement[] = [];
  const labels: Label[] = [];
  spec.annotations.forEach((a, i) => {
    const d = DRAWERS[a.type](a, ctx);
    groups.push(
      el(
        'g',
        { 'data-fd-annotation': String(i), 'data-fd-type': a.type, ...d.group },
        d.marks,
      ),
    );
    labels.push(d.label);
  });

  const labelEls = layoutLabels(labels).map(labelEl);

  const caption = (who: Person, word: string): SvgElement[] => {
    const h = who.joints[who.head];
    return h
      ? [
          text(toPx(h)[0], CANVAS_H - 8, word, {
            'font-size': '11',
            fill: palette.muted,
          }),
        ]
      : [];
  };

  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${CANVAS_W} ${CANVAS_H}`,
      role: 'img',
      'data-fd-base': base.id,
      'data-fd-skin': skin,
    },
    [
      el('title', {}, [opts.title ?? `${base.label} force diagram`]),
      el('rect', {
        width: String(CANVAS_W),
        height: String(CANVAS_H),
        fill: palette.surface,
      }),
      line([40, CANVAS_H - 48], [CANVAS_W - 40, CANVAS_H - 48], {
        stroke: palette.mat,
        'stroke-width': '6',
        'stroke-linecap': 'round',
      }),
      el('g', { 'data-fd-figure': 'opp' }, drawSkin(opp, palette.opp)),
      el('g', { 'data-fd-figure': 'you' }, drawSkin(you, palette.you)),
      el('g', { 'data-fd-overlay': '' }, groups),
      el('g', { 'data-fd-labels': '' }, labelEls),
      ...caption(opp, 'opponent'),
      ...caption(you, 'you'),
    ],
  );
}

/**
 * Render a force diagram: validates the base and the spec (the floor), then
 * draws. The same `(base, spec, opts)` always yields byte-identical `svg`.
 * Never throws — `ok: false` means "no diagram, show the cue as text".
 */
export function renderForceDiagram(
  base: DiagramBase,
  spec: unknown,
  opts: RenderOptions = {},
): RenderResult {
  const parsed = parseBase(base);
  if (!parsed.ok)
    return {
      ok: false,
      errors: parsed.errors.map((e) => `base: ${e}`),
      warnings: [],
    };
  const v = validateSpec(spec, parsed.base);
  if (!v.ok) return v;
  try {
    const tree = buildTree(parsed.base, v.spec, opts);
    return {
      ok: true,
      svg: serializeSvg(tree),
      tree,
      spec: v.spec,
      warnings: v.warnings,
    };
  } catch (e) {
    return {
      ok: false,
      errors: [`render failed: ${e instanceof Error ? e.message : String(e)}`],
      warnings: v.warnings,
    };
  }
}
