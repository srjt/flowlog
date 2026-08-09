// Spike harness for wayfinder ticket #12 — does reference-conditioning clear the
// (b) never-misleading floor? For each position in spike/manifest.json it
// generates, with `gemini-3-pro-image` (override with --model / IMAGE_MODEL):
//   • a TEXT-ONLY baseline (current production behaviour)
//   • one CONDITIONED output per reference (photo and/or diagram)
// so the panel can eyeball text-only vs photo- vs diagram-conditioning side by
// side. Outputs land in spike/out/. No Supabase, no deploy — just a Gemini key.
//
//   GEMINI_API_KEY=... node scripts/spikeRefConditioning.ts
//   GEMINI_API_KEY=... node scripts/spikeRefConditioning.ts --model gemini-3-pro-image
//
// Runs on Node 24 (type-stripping). Auto-loads .env like scripts/testCueImage.ts.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { buildCueImagePrompt } from '../src/utils/cueImagePrompt.ts';
import { BJJ_IMAGE_STYLE_HINT } from '../src/sports/bjj/bjjPrompts.ts';

try {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env */
}

const args = process.argv.slice(2);
const modelArg = args[args.indexOf('--model') + 1];
const MODEL =
  (args.includes('--model') && modelArg) ||
  process.env.IMAGE_MODEL ||
  process.env.EXPO_PUBLIC_IMAGE_MODEL ||
  'gemini-3-pro-image';
const KEY =
  process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Ref {
  type: 'photo' | 'diagram';
  path: string;
}
interface Position {
  name: string;
  cue: string;
  refs: Ref[];
}
interface Manifest {
  model?: string;
  positions: Position[];
}

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function gen(parts: unknown[]): Promise<Buffer> {
  const res = await fetch(
    `${BASE}/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );
  if (!res.ok) fail(`Request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const out = (data.candidates?.[0]?.content?.parts ?? []).find(
    (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
  )?.inlineData;
  if (!out?.data)
    fail(`No inline image. Raw: ${JSON.stringify(data).slice(0, 400)}`);
  return Buffer.from(out.data, 'base64');
}

function conditionedParts(ref: Ref, name: string, cue: string): unknown[] {
  const ext = ref.path.split('.').pop()?.toLowerCase() ?? 'png';
  const b64 = readFileSync(new URL(`../${ref.path}`, import.meta.url)).toString(
    'base64',
  );
  const instruction =
    `The attached image is a reference showing the correct body configuration ` +
    `for the "${name}" position in Brazilian Jiu-Jitsu. Redraw it as a clean, ` +
    `flat, minimal instructional line diagram — white linework on a dark ` +
    `background, single clear subject, NO text, letters, or numbers. Preserve ` +
    `the EXACT body positions, limb placement, grips, and who-is-on-top from ` +
    `the reference — do not change the position. Emphasize the mechanic in ` +
    `this coaching cue: "${cue}".`;
  return [
    { inlineData: { mimeType: MIME[ext] ?? 'image/png', data: b64 } },
    { text: instruction },
  ];
}

async function main() {
  if (!KEY) fail('Set GEMINI_API_KEY.');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      readFileSync(new URL('../spike/manifest.json', import.meta.url), 'utf8'),
    );
  } catch {
    fail(
      'No spike/manifest.json. Copy spike/manifest.example.json to spike/manifest.json, ' +
        'drop your reference files in spike/refs/, and fill in name + cue + refs.',
    );
  }

  mkdirSync(new URL('../spike/out/', import.meta.url), { recursive: true });
  console.log(`\nmodel: ${MODEL}\n`);

  for (const pos of manifest.positions) {
    const s = slug(pos.name);
    console.log(`── ${pos.name} ──`);
    console.log(`   cue: "${pos.cue}"`);

    // Text-only baseline (current production behaviour).
    const baseline = await gen([
      {
        text: buildCueImagePrompt({
          cue: pos.cue,
          targetPosition: pos.name,
          styleHint: BJJ_IMAGE_STYLE_HINT,
        }),
      },
    ]);
    writeFileSync(new URL(`../spike/out/${s}__text-only.png`, import.meta.url), baseline);
    console.log(`   ✅ text-only        → spike/out/${s}__text-only.png`);

    // Conditioned on each reference.
    for (const ref of pos.refs) {
      const img = await gen(conditionedParts(ref, pos.name, pos.cue));
      writeFileSync(
        new URL(`../spike/out/${s}__${ref.type}.png`, import.meta.url),
        img,
      );
      console.log(`   ✅ ${ref.type.padEnd(8)}       → spike/out/${s}__${ref.type}.png`);
    }
    console.log();
  }
  console.log('Open them:  open spike/out/*.png\n');
}

main().catch((e) => fail(String(e?.stack ?? e)));
