// #18 harness — the DETERMINISTIC SVG renderer.
//
// Input: a validated Spec + its Position seed. Output: an SVG string. Nothing
// is generated; every coloured mark is drawn from the spec by resolving its
// semantic roles to coordinates (keypoints.resolveRole) and running a fixed
// per-primitive draw routine. Grey = base skin (swappable keypoint skeleton);
// colour = overlay.
//
// Static-complete + animation-additive: the diagram reads fully without motion;
// animation is a layer keyed by CSS class, disabled under prefers-reduced-motion.
// Visual target: spike/dlr-force-diagram-mockup.html.

import type { Annotation, Spec } from './grammar.ts';
import { PRIMITIVES } from './grammar.ts';
import {
  CANVAS_H,
  CANVAS_W,
  type Person,
  type Position,
  type Vec,
  resolveRole,
  toPx,
} from './keypoints.ts';

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
const r2 = (n: number): string => Math.round(n * 100) / 100 + '';

const INTENSITY: Record<string, number> = { low: 0.62, medium: 0.8, high: 1 };
const intensityOf = (a: Annotation): number => INTENSITY[a.intensity ?? 'medium'];

// Humanize a role id into a short label fragment.
function humanize(role: string): string {
  return role
    .replace(/^opp_/, "opponent's ")
    .replace(/^(you_|your_)/, 'your ')
    .replace(/_/g, ' ');
}

function relationTarget(a: Annotation): string | null {
  const r = a.relation;
  if (!r) return null;
  if ('toward' in r) return r.toward;
  if ('away_from' in r) return r.away_from;
  if ('around' in r) return r.around;
  return null;
}

interface Ctx {
  pos: Position;
  idx: number; // diagram index — namespaces marker ids across a gallery
}
interface Label {
  at: Vec;
  text: string;
  colorVar: string;
}
interface Drawn {
  svg: string;
  label: Label | null;
}

// ── base skin ───────────────────────────────────────────────────────────────
function drawPerson(p: Person, colorVar: string): string {
  const parts: string[] = [];
  parts.push(
    `<g fill="none" stroke="var(${colorVar})" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">`,
  );
  for (const [a, b] of p.bones) {
    const pa = toPx(p.joints[a]);
    const pb = toPx(p.joints[b]);
    parts.push(
      `<line x1="${r2(pa[0])}" y1="${r2(pa[1])}" x2="${r2(pb[0])}" y2="${r2(pb[1])}"/>`,
    );
  }
  parts.push('</g>');
  const h = toPx(p.joints[p.head]);
  parts.push(
    `<circle cx="${r2(h[0])}" cy="${r2(h[1])}" r="22" fill="var(${colorVar})"/>`,
  );
  return parts.join('');
}

// ── fleshed skin ────────────────────────────────────────────────────────────
// A deterministic, volume-carrying figure drawn from the SAME keypoints: each
// bone becomes a tapered limb (a quad between the two joints' radii, capped by a
// circle at each joint so joints round smoothly), plus directional feet from the
// authored toe points. No generation — swapping this in for drawPerson is the
// "swappable skin" the map calls for (decision #4/#5).

// Per-joint limb thickness, inferred from the joint name. BJJ keypoint names are
// custom per position, so match on keywords rather than a fixed joint set.
function jointRadius(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('hip') || n.includes('pelvis') || n.includes('waist')) return 17;
  if (n.includes('chest')) return 16;
  if (n.includes('shoulder')) return 13;
  if (n.includes('neck')) return 12;
  if (n.includes('knee')) return 12;
  if (n.includes('foot') || n.includes('ankle') || n.includes('heel')) return 8;
  if (n.includes('elbow')) return 9;
  if (n.includes('hand') || n.includes('wrist')) return 7;
  return 10;
}

function limbQuad(a: Vec, ra: number, b: Vec, rb: number): string {
  const d = unit(sub(b, a));
  const n = perp(d);
  const p1 = add(a, scale(n, ra));
  const p2 = sub(a, scale(n, ra));
  const p3 = sub(b, scale(n, rb));
  const p4 = add(b, scale(n, rb));
  return `<polygon points="${r2(p1[0])},${r2(p1[1])} ${r2(p4[0])},${r2(p4[1])} ${r2(p3[0])},${r2(p3[1])} ${r2(p2[0])},${r2(p2[1])}"/>`;
}

function drawFoot(ankle: Vec, toe: Vec, colorVar: string): string {
  // Heel bump at the ankle + a capsule sole from ankle toward the toe. The
  // capsule (round-capped thick line) points the foot; the toe is the far cap.
  return (
    `<line x1="${r2(ankle[0])}" y1="${r2(ankle[1])}" x2="${r2(toe[0])}" y2="${r2(toe[1])}" stroke="var(${colorVar})" stroke-width="15" stroke-linecap="round"/>` +
    `<circle cx="${r2(ankle[0])}" cy="${r2(ankle[1])}" r="9" fill="var(${colorVar})"/>`
  );
}

function drawPersonFleshed(p: Person, colorVar: string): string {
  const parts: string[] = [`<g fill="var(${colorVar})" stroke="none">`];
  // limbs + rounded joints
  for (const [a, b] of p.bones) {
    const pa = toPx(p.joints[a]);
    const pb = toPx(p.joints[b]);
    const ra = jointRadius(a);
    const rb = jointRadius(b);
    parts.push(limbQuad(pa, ra, pb, rb));
    parts.push(`<circle cx="${r2(pa[0])}" cy="${r2(pa[1])}" r="${ra}"/>`);
    parts.push(`<circle cx="${r2(pb[0])}" cy="${r2(pb[1])}" r="${rb}"/>`);
  }
  parts.push('</g>');
  // directional feet
  for (const [ankleName, foot] of Object.entries(p.feet ?? {})) {
    const ankle = p.joints[ankleName];
    if (!ankle) continue;
    parts.push(drawFoot(toPx(ankle), toPx(foot.toe), colorVar));
  }
  // head — a slightly taller ellipse reads more human than a bare circle
  const h = toPx(p.joints[p.head]);
  parts.push(
    `<ellipse cx="${r2(h[0])}" cy="${r2(h[1])}" rx="20" ry="23" fill="var(${colorVar})"/>`,
  );
  return parts.join('');
}

export type Skin = 'stickman' | 'fleshed';

// ── per-primitive draw routines ─────────────────────────────────────────────
function drawForce(a: Annotation, ctx: Ctx): Drawn {
  const origin = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const target = toPx(resolveRole(ctx.pos, relationTarget(a)!));
  const dir = unit(sub(target, origin));
  const away = a.relation && 'away_from' in a.relation;
  const d = away ? scale(dir, -1) : dir;
  const dist = len(sub(target, origin));
  const l = Math.min(95 * intensityOf(a), Math.max(44, dist * 1.6));
  const tip = add(origin, scale(d, l));
  const w = 4 + 2.5 * intensityOf(a);
  const mid = add(origin, scale(d, l * 0.55));
  return {
    svg:
      `<g class="fd-force">` +
      arrow(origin, tip, 'var(--push)', w, `fdPush${ctx.idx}`) +
      `<line class="fd-flow" x1="${r2(origin[0])}" y1="${r2(origin[1])}" x2="${r2(tip[0])}" y2="${r2(tip[1])}" stroke="var(--surface)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 13" opacity=".85"/>` +
      `</g>`,
    label: { at: add(mid, scale(perp(d), -18)), text: `drive into ${humanize(relationTarget(a)!)}`, colorVar: '--push' },
  };
}

function drawPressure(a: Annotation, ctx: Ctx): Drawn {
  const c = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const k = intensityOf(a);
  return {
    svg:
      `<circle class="fd-halo" cx="${r2(c[0])}" cy="${r2(c[1])}" r="${r2(34 * k)}" fill="var(--pressure)"/>` +
      `<circle class="fd-core" cx="${r2(c[0])}" cy="${r2(c[1])}" r="${r2(13 * k)}" fill="var(--pressure)"/>`,
    label: { at: add(c, [0, -46]), text: 'pressure', colorVar: '--pressure' },
  };
}

function drawCounter(a: Annotation, ctx: Ctx): Drawn {
  const origin = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const target = toPx(resolveRole(ctx.pos, relationTarget(a)!));
  const dir = unit(sub(target, origin));
  const d = a.relation && 'away_from' in a.relation ? scale(dir, -1) : dir;
  const tip = add(origin, scale(d, 66));
  const n = perp(d);
  // block "X" just short of the tip
  const bx = add(origin, scale(d, 30));
  const x1 = add(bx, scale(n, 9));
  const x2 = sub(bx, scale(n, 9));
  const x3 = add(add(bx, scale(d, 12)), scale(n, 9));
  const x4 = sub(add(bx, scale(d, 12)), scale(n, 9));
  return {
    svg:
      `<g class="fd-counter"><line x1="${r2(origin[0])}" y1="${r2(origin[1])}" x2="${r2(tip[0])}" y2="${r2(tip[1])}" stroke="var(--counter)" stroke-width="4" stroke-dasharray="7 6" marker-end="url(#fdCounter${ctx.idx})"/></g>` +
      `<g stroke="var(--counter)" stroke-width="3" stroke-linecap="round"><line x1="${r2(x1[0])}" y1="${r2(x1[1])}" x2="${r2(x4[0])}" y2="${r2(x4[1])}"/><line x1="${r2(x2[0])}" y1="${r2(x2[1])}" x2="${r2(x3[0])}" y2="${r2(x3[1])}"/></g>`,
    label: { at: add(tip, scale(d, 6)), text: 'blocks their force', colorVar: '--muted' },
  };
}

function drawBase(a: Annotation, ctx: Ctx): Drawn {
  const c = toPx(resolveRole(ctx.pos, single(a.anchor)));
  return {
    svg:
      `<circle cx="${r2(c[0])}" cy="${r2(c[1])}" r="13" fill="none" stroke="var(--base)" stroke-width="3"/>` +
      `<circle cx="${r2(c[0])}" cy="${r2(c[1])}" r="3.5" fill="var(--base)"/>`,
    label: { at: add(c, [0, 30]), text: 'base', colorVar: '--base' },
  };
}

function drawGrip(a: Annotation, ctx: Ctx): Drawn {
  const roles = Array.isArray(a.anchor) ? a.anchor : [a.anchor];
  const hand = toPx(resolveRole(ctx.pos, roles[0]));
  const tgt = toPx(resolveRole(ctx.pos, roles[1]));
  return {
    svg:
      `<line x1="${r2(hand[0])}" y1="${r2(hand[1])}" x2="${r2(tgt[0])}" y2="${r2(tgt[1])}" stroke="var(--grip)" stroke-width="3.5" stroke-linecap="round"/>` +
      `<circle cx="${r2(tgt[0])}" cy="${r2(tgt[1])}" r="10" fill="none" stroke="var(--grip)" stroke-width="3.5"/>` +
      `<circle cx="${r2(hand[0])}" cy="${r2(hand[1])}" r="5" fill="var(--grip)"/>`,
    label: { at: add(tgt, [0, -18]), text: `grip ${humanize(roles[1])}`, colorVar: '--grip' },
  };
}

function drawFrame(a: Annotation, ctx: Ctx): Drawn {
  const anchor = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const tgtRole = relationTarget(a);
  const dir = tgtRole
    ? scale(unit(sub(toPx(resolveRole(ctx.pos, tgtRole)), anchor)), -1) // away_from target
    : ([0, -1] as Vec);
  const n = perp(dir);
  const barA = add(anchor, scale(n, 20));
  const barB = sub(anchor, scale(n, 20));
  const prongA = add(barA, scale(dir, 16));
  const prongB = add(barB, scale(dir, 16));
  return {
    svg:
      `<g stroke="var(--frame)" stroke-width="5" stroke-linecap="round" fill="none">` +
      `<line x1="${r2(barA[0])}" y1="${r2(barA[1])}" x2="${r2(barB[0])}" y2="${r2(barB[1])}"/>` +
      `<line x1="${r2(barA[0])}" y1="${r2(barA[1])}" x2="${r2(prongA[0])}" y2="${r2(prongA[1])}"/>` +
      `<line x1="${r2(barB[0])}" y1="${r2(barB[1])}" x2="${r2(prongB[0])}" y2="${r2(prongB[1])}"/>` +
      `</g>`,
    label: { at: add(anchor, scale(dir, 24)), text: tgtRole ? `frame off ${humanize(tgtRole)}` : 'frame', colorVar: '--frame' },
  };
}

function drawRotation(a: Annotation, ctx: Ctx): Drawn {
  const pivot = toPx(resolveRole(ctx.pos, relationTarget(a)!));
  const anchor = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const rad = Math.max(26, len(sub(anchor, pivot)));
  const a0 = Math.atan2(anchor[1] - pivot[1], anchor[0] - pivot[0]);
  const a1 = a0 + 2.1; // ~120deg CCW sweep
  const p0: Vec = [pivot[0] + rad * Math.cos(a0), pivot[1] + rad * Math.sin(a0)];
  const p1: Vec = [pivot[0] + rad * Math.cos(a1), pivot[1] + rad * Math.sin(a1)];
  const tan: Vec = [-Math.sin(a1), Math.cos(a1)];
  const tip = p1;
  const back = sub(p1, scale(tan, 1));
  return {
    svg:
      `<path class="fd-rot" d="M ${r2(p0[0])} ${r2(p0[1])} A ${r2(rad)} ${r2(rad)} 0 0 1 ${r2(p1[0])} ${r2(p1[1])}" fill="none" stroke="var(--rotation)" stroke-width="4.5" marker-end="url(#fdRot${ctx.idx})"/>` +
      `<circle cx="${r2(pivot[0])}" cy="${r2(pivot[1])}" r="4" fill="var(--rotation)"/>` +
      `<!-- ${r2(back[0])} ${r2(tip[0])} -->`,
    label: { at: add(p1, [0, -14]), text: `rotate around ${humanize(relationTarget(a)!)}`, colorVar: '--rotation' },
  };
}

function drawWeight(a: Annotation, ctx: Ctx): Drawn {
  const c = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const k = intensityOf(a);
  const rows = Math.round(2 + k); // 2-3 chevrons
  const chevrons: string[] = [];
  for (let i = 0; i < rows; i++) {
    const y = c[1] - 26 - i * 12;
    chevrons.push(
      `<polyline points="${r2(c[0] - 12)},${r2(y)} ${r2(c[0])},${r2(y + 9)} ${r2(c[0] + 12)},${r2(y)}" fill="none" stroke="var(--weight)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="${r2(0.5 + i * 0.2)}"/>`,
    );
  }
  return {
    svg:
      chevrons.join('') +
      `<circle cx="${r2(c[0])}" cy="${r2(c[1])}" r="6" fill="var(--weight)"/>`,
    label: { at: add(c, [0, 22]), text: 'weight', colorVar: '--weight' },
  };
}

function drawMovement(a: Annotation, ctx: Ctx): Drawn {
  const origin = toPx(resolveRole(ctx.pos, single(a.anchor)));
  const target = toPx(resolveRole(ctx.pos, relationTarget(a)!));
  return {
    svg:
      `<line class="fd-flow" x1="${r2(origin[0])}" y1="${r2(origin[1])}" x2="${r2(target[0])}" y2="${r2(target[1])}" stroke="var(--movement)" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12" marker-end="url(#fdMove${ctx.idx})"/>`,
    label: { at: add(target, [0, -14]), text: `move to ${humanize(relationTarget(a)!)}`, colorVar: '--movement' },
  };
}

const DRAWERS: Record<string, (a: Annotation, ctx: Ctx) => Drawn> = {
  force: drawForce,
  pressure: drawPressure,
  counter: drawCounter,
  base: drawBase,
  grip: drawGrip,
  frame: drawFrame,
  rotation: drawRotation,
  'weight-distribution': drawWeight,
  'movement-path': drawMovement,
};

function single(anchor: string | string[]): string {
  return Array.isArray(anchor) ? anchor[0] : anchor;
}

function arrow(
  from: Vec,
  to: Vec,
  color: string,
  width: number,
  markerId: string,
): string {
  return `<line x1="${r2(from[0])}" y1="${r2(from[1])}" x2="${r2(to[0])}" y2="${r2(to[1])}" stroke="${color}" stroke-width="${r2(width)}" stroke-linecap="round" marker-end="url(#${markerId})"/>`;
}

// markerUnits="userSpaceOnUse" keeps arrowheads a constant size regardless of
// the line's stroke width (the default scales them, which balloons thick arrows).
function markerDefs(idx: number): string {
  const m = (id: string, w: number, colorVar: string) =>
    `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="${w}" markerHeight="${w}" refX="${w * 0.7}" refY="${w / 2}" orient="auto"><path d="M0,0 L${w},${w / 2} L0,${w} L${w * 0.3},${w / 2} Z" fill="var(${colorVar})"/></marker>`;
  return (
    `<defs>` +
    m(`fdPush${idx}`, 18, '--push') +
    m(`fdCounter${idx}`, 15, '--counter') +
    m(`fdRot${idx}`, 15, '--rotation') +
    m(`fdMove${idx}`, 15, '--movement') +
    `</defs>`
  );
}

// Nudge labels apart vertically so a cluster of marks near one contact point
// doesn't stack their text on top of each other.
function layoutLabels(labels: Label[]): Label[] {
  const sorted = labels
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.at[1] - b.l.at[1]);
  let lastY = -Infinity;
  let lastX = 0;
  for (const { l } of sorted) {
    if (l.at[1] < lastY + 17 && Math.abs(l.at[0] - lastX) < 190)
      l.at = [l.at[0], lastY + 17];
    lastY = l.at[1];
    lastX = l.at[0];
  }
  return labels;
}

function labelSvg(l: Label): string {
  const x = Math.max(8, Math.min(CANVAS_W - 8, l.at[0]));
  const y = Math.max(14, Math.min(CANVAS_H - 6, l.at[1]));
  return `<text x="${r2(x)}" y="${r2(y)}" text-anchor="middle" font-size="12.5" font-weight="600" fill="var(${l.colorVar})" font-family="ui-sans-serif, system-ui, sans-serif">${escapeXml(l.text)}</text>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}

export interface RenderOpts {
  /** which base skin to draw (default 'stickman'). */
  skin?: Skin;
  /** draw the spec overlay (default true); false = base skin alone. */
  overlay?: boolean;
}

/** Render one diagram (base skin + overlay from the spec). Returns an <svg>. */
export function renderDiagramSvg(
  pos: Position,
  spec: Spec,
  idx: number,
  opts: RenderOpts = {},
): string {
  const skin = opts.skin ?? 'stickman';
  const showOverlay = opts.overlay ?? true;
  const ctx: Ctx = { pos, idx };
  const peopleIds = Object.keys(pos.people);
  const opp = pos.people[peopleIds.find((k) => k === 'opp') ?? peopleIds[0]];
  const you = pos.people[peopleIds.find((k) => k === 'you') ?? peopleIds[1]];

  const overlay: string[] = [];
  const labels: Label[] = [];
  if (showOverlay)
    for (const ann of spec.annotations) {
      const drawer = DRAWERS[ann.type];
      if (!drawer) continue; // validator already flagged; skip unknown
      if (!PRIMITIVES[ann.type]) continue;
      const d = drawer(ann, ctx);
      overlay.push(d.svg);
      if (d.label) labels.push(d.label);
    }

  const mat = `<line x1="40" y1="${CANVAS_H - 48}" x2="${CANVAS_W - 40}" y2="${CANVAS_H - 48}" stroke="var(--mat)" stroke-width="6" stroke-linecap="round"/>`;
  const drawSkin = skin === 'fleshed' ? drawPersonFleshed : drawPerson;

  return (
    `<svg viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" role="img" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${escapeXml(pos.label)} force diagram (${skin})</title>` +
    markerDefs(idx) +
    mat +
    drawSkin(opp, '--opp') +
    drawSkin(you, '--you') +
    overlay.join('') +
    layoutLabels(labels).map(labelSvg).join('') +
    `<text x="${r2(toPx(opp.joints[opp.head])[0])}" y="${CANVAS_H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="ui-sans-serif, system-ui, sans-serif">opponent</text>` +
    `<text x="${r2(toPx(you.joints[you.head])[0])}" y="${CANVAS_H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="ui-sans-serif, system-ui, sans-serif">you</text>` +
    `</svg>`
  );
}

// ── page shell (gallery) ────────────────────────────────────────────────────
export const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f0eee9; color: #1c1d21; }
  @media (prefers-color-scheme: dark) { body { background: #101114; color: #e9eaec; } }
  .wrap { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 13px; opacity: .75; line-height: 1.5; margin: 0 0 20px; max-width: 820px; }
  .sub code { font-family: ui-monospace, Menlo, monospace; }
  .posh { font-size: 15px; letter-spacing: .04em; text-transform: uppercase; margin: 26px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
  .fd { --you:#565b63; --opp:#9aa0a8; --mat:#d8d2c6; --text:#1c1d21; --muted:#6a7078;
    --push:#dd6427; --pressure:#dd6427; --counter:#9aa0a6; --base:#2f77d6; --grip:#2f9e6d; --frame:#7b61c9; --rotation:#c94f8a; --weight:#b58a1f; --movement:#3f9bd0;
    --surface:#faf9f7; --border:rgba(0,0,0,.10); --panel:#f4f2ee; color:var(--text); }
  @media (prefers-color-scheme: dark) { .fd {
    --you:#c6ccd4; --opp:#7f858d; --mat:#35373c; --text:#e9eaec; --muted:#9aa0a8;
    --push:#ff8a4c; --pressure:#ff8a4c; --counter:#737980; --base:#64a2f5; --grip:#46c088; --frame:#a58bf0; --rotation:#ef7bb2; --weight:#d9b64a; --movement:#6cc0ef;
    --surface:#17181b; --border:rgba(255,255,255,.12); --panel:#1d1f23; } }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .card svg { display: block; width: 100%; height: auto; background: var(--surface); }
  .meta { padding: 11px 13px; border-top: 1px solid var(--border); }
  .cueid { font-size: 10.5px; letter-spacing:.05em; text-transform: uppercase; color: var(--muted); }
  .cuetext { font-size: 13px; line-height: 1.4; margin: 3px 0 8px; }
  .badge { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }
  .ok { background: rgba(47,158,109,.16); color: #2f9e6d; }
  .bad { background: rgba(221,60,60,.16); color: #d64545; }
  .src { font-size: 10px; color: var(--muted); margin-left: 6px; }
  details { margin-top: 8px; }
  summary { font-size: 11px; color: var(--muted); cursor: pointer; }
  pre { margin: 6px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; color: var(--muted); }
  .errs { color: #d64545; font-size: 11px; margin-top: 6px; }
  .legend { display:flex; flex-wrap:wrap; gap:14px 20px; margin: 4px 0 8px; font-size:12px; }
  .legend .fd { display:flex; align-items:center; gap:7px; }
  .fd-force { animation: fdDrive 1.6s ease-in-out infinite; }
  .fd-flow  { animation: fdFlow 1.1s linear infinite; }
  .fd-core  { transform-box: fill-box; transform-origin: center; animation: fdPulse 1.6s ease-in-out infinite; }
  .fd-halo  { transform-box: fill-box; transform-origin: center; animation: fdHalo 1.6s ease-in-out infinite; }
  .fd-counter { animation: fdShove 2.2s ease-in-out infinite; }
  @keyframes fdDrive { 0%,100% { transform: translate(0,0); } 50% { transform: translate(5px,-6px); } }
  @keyframes fdFlow { to { stroke-dashoffset: -40; } }
  @keyframes fdPulse { 0%,100% { transform: scale(1); opacity:.34; } 50% { transform: scale(1.28); opacity:.52; } }
  @keyframes fdHalo { 0%,100% { transform: scale(1); opacity:.15; } 50% { transform: scale(1.15); opacity:.24; } }
  @keyframes fdShove { 0%,100% { transform: translate(0,0); } 45% { transform: translate(-5px,0); } 60% { transform: translate(-1px,0); } }
  @media (prefers-reduced-motion: reduce) { .fd-force,.fd-flow,.fd-core,.fd-halo,.fd-counter { animation: none !important; } }
`;
