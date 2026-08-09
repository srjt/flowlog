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
// Idempotent: skips any spike/out/*.png that already exists (so re-runs only
// generate new positions). Pass --force to regenerate everything.
//
// Runs on Node 24 (type-stripping). Auto-loads .env like scripts/testCueImage.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const cand = (await res.json()).candidates?.[0];
  const out = (cand?.content?.parts ?? []).find(
    (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
  )?.inlineData;
  if (!out?.data) {
    const reason = cand?.finishReason ?? 'unknown';
    throw new Error(
      reason === 'PROHIBITED_CONTENT' || reason === 'SAFETY'
        ? `BLOCKED by safety filter (${reason})`
        : `no image returned (finishReason=${reason})`,
    );
  }
  return Buffer.from(out.data, 'base64');
}

const FORCE = args.includes('--force');
const outUrl = (name: string) => new URL(`../spike/out/${name}`, import.meta.url);

// Generate + write, unless the output already exists (idempotent re-runs).
// `partsFn` is lazy so we don't even read a reference file when skipping.
type Outcome = 'generated' | 'skipped' | 'failed';

async function produce(
  name: string,
  label: string,
  partsFn: () => unknown[],
): Promise<Outcome> {
  const url = outUrl(name);
  if (!FORCE && existsSync(url)) {
    console.log(`   ⏭️  ${label.padEnd(10)} exists → spike/out/${name}`);
    return 'skipped';
  }
  try {
    writeFileSync(url, await gen(partsFn()));
    console.log(`   ✅ ${label.padEnd(10)} → spike/out/${name}`);
    return 'generated';
  } catch (e) {
    // One blocked/failed variant must not abort the batch.
    console.log(`   ⚠️  ${label.padEnd(10)} FAILED — ${(e as Error).message}`);
    return 'failed';
  }
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

  const tally: Record<Outcome, number> = { generated: 0, skipped: 0, failed: 0 };

  for (const pos of manifest.positions) {
    const s = slug(pos.name);
    console.log(`── ${pos.name} ──`);
    console.log(`   cue: "${pos.cue}"`);

    // Text-only baseline (current production behaviour).
    tally[
      await produce(`${s}__text-only.png`, 'text-only', () => [
        {
          text: buildCueImagePrompt({
            cue: pos.cue,
            targetPosition: pos.name,
            styleHint: BJJ_IMAGE_STYLE_HINT,
          }),
        },
      ])
    ]++;

    // Conditioned on each reference.
    for (const ref of pos.refs) {
      tally[
        await produce(`${s}__${ref.type}.png`, ref.type, () =>
          conditionedParts(ref, pos.name, pos.cue),
        )
      ]++;
    }
    console.log();
  }
  console.log(
    `Summary — generated ${tally.generated}, skipped ${tally.skipped}, failed ${tally.failed}.`,
  );
  console.log('Open them:  open spike/out/*.png\n');
}

main().catch((e) => fail(String(e?.stack ?? e)));
