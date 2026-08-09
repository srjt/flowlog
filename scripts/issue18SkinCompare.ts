// #18 — base-skin comparison. Renders the SAME de la riva keypoints + the SAME
// heel-hamstring spec with two swappable base skins: the debug stickman and a
// deterministic "fleshed" figure (volume limbs + directional feet from authored
// toe points). No generation anywhere — this is the "swappable visual skin"
// from map decisions #4/#5, sharpening the "base visual skin for v1" fog.
//
//   node scripts/issue18SkinCompare.ts   ->  spike/issue18-skin-comparison.html
//
// Runs on Node 24 (type-stripping).

import { readFileSync, writeFileSync } from 'node:fs';

import { type Spec, SPEC_VERSION } from './issue18/grammar.ts';
import { type Position } from './issue18/keypoints.ts';
import { PAGE_CSS, type Skin, renderDiagramSvg } from './issue18/renderer.ts';

const seedUrl = (name: string) => new URL(`./issue18/seed/${name}`, import.meta.url);
const pos = JSON.parse(readFileSync(seedUrl('de-la-riva.json'), 'utf8')) as Position;
const refSpecs = JSON.parse(
  readFileSync(seedUrl('reference-specs.json'), 'utf8'),
) as Record<string, Record<string, Spec['annotations']>>;

const spec: Spec = {
  specVersion: SPEC_VERSION,
  base: pos.id,
  annotations: refSpecs['de-la-riva']['heel-hamstring'],
};

let idx = 0;
const cell = (title: string, note: string, skin: Skin, overlay: boolean) =>
  `<div class="card"><div class="fd">${renderDiagramSvg(pos, spec, idx++, { skin, overlay })}</div>` +
  `<div class="meta"><div class="cueid">${title}</div><div class="cuetext">${note}</div></div></div>`;

const html =
  `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
  `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
  `<title>#18 — base skin comparison (de la riva)</title><style>${PAGE_CSS}</style></head><body>` +
  `<div class="wrap"><h1>Base skin comparison — de la riva</h1>` +
  `<p class="sub">Same keypoints, same spec, two <strong>swappable base skins</strong> — both drawn ` +
  `<strong>deterministically</strong>, no image generation. The <strong>fleshed</strong> skin adds limb volume and ` +
  `<strong>directional feet</strong> from authored toe points (toe direction is a keypoint, authored per position, ` +
  `not guessed by a model). Top row = base skin alone; bottom row = the identical ` +
  `<code>heel-hamstring</code> force overlay on each. This is the "base visual skin for v1" question from map #10.</p>` +
  `<h2 class="posh">Base skin only</h2><div class="grid">` +
  cell('STICKMAN', 'Debug / authoring view — bones as strokes, feet are bare points (no toe direction).', 'stickman', false) +
  cell('FLESHED', 'Volume limbs + directional feet drawn from the same joints. Note the toes point where authored.', 'fleshed', false) +
  `</div>` +
  `<h2 class="posh">With the heel-hamstring overlay</h2><div class="grid">` +
  cell('STICKMAN + OVERLAY', 'The current harness default.', 'stickman', true) +
  cell('FLESHED + OVERLAY', 'Identical spec + overlay, richer body. Same code path, one skin flag.', 'fleshed', true) +
  `</div></div></body></html>`;

const OUT = 'spike/issue18-skin-comparison.html';
writeFileSync(new URL(`../${OUT}`, import.meta.url), html);
console.log(`Wrote ${OUT}\n   open ${OUT}`);
