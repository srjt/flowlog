// Standalone smoke test for the cue-image pipeline (ADR 0012) — no RN, no
// Expo, no edge deploy. Imports the REAL shipping logic (reuse key + prompt +
// BJJ style hint) so it faithfully mirrors production.
//
// Run on Node 24 (type-stripping is built in):
//
//   # Step 1 — generation only (needs just a Gemini key):
//   GEMINI_API_KEY=AIza... node scripts/testCueImage.ts "Frame early and shrimp to recover guard." "closed guard"
//
//   # Step 2 — full storage path (adds Supabase service role):
//   GEMINI_API_KEY=AIza... SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/testCueImage.ts --upload "Frame early and shrimp." "closed guard"
//
// It auto-loads a local .env if present (EXPO_PUBLIC_* names are recognised).

import { readFileSync, writeFileSync } from 'node:fs';

import { deriveCueImageKey } from '../src/utils/cueImageKey.ts';
import { buildCueImagePrompt } from '../src/utils/cueImagePrompt.ts';
import { BJJ_IMAGE_STYLE_HINT } from '../src/sports/bjj/bjjPrompts.ts';

// ── tiny .env loader (KEY=VALUE lines; does not override real env) ───────────
try {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* no .env — rely on real env */
}

const pick = (...names: string[]) =>
  names.map((n) => process.env[n]).find((v) => v && v.trim()) ?? '';

const GEMINI_API_KEY = pick('GEMINI_API_KEY', 'EXPO_PUBLIC_GEMINI_API_KEY');
const SUPABASE_URL = pick('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
const SERVICE_ROLE = pick('SUPABASE_SERVICE_ROLE_KEY');
const IMAGE_MODEL = pick('IMAGE_MODEL', 'EXPO_PUBLIC_IMAGE_MODEL') || 'gemini-2.5-flash-image';
const BUCKET = 'cue-images';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const args = process.argv.slice(2);
const upload = args.includes('--upload');
const positional = args.filter((a) => !a.startsWith('--'));
const cue = positional[0] ?? 'Frame early and shrimp to recover guard.';
const targetPosition = positional[1] ?? 'closed guard';

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function generate(prompt: string): Promise<{ bytes: Buffer; contentType: string }> {
  const isImagen = IMAGE_MODEL.startsWith('imagen');
  const url = `${GEMINI_BASE}/${IMAGE_MODEL}:${isImagen ? 'predict' : 'generateContent'}?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = isImagen
    ? { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '1:1' } }
    : {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`Image request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (isImagen) {
    const p = data.predictions?.[0];
    if (!p?.bytesBase64Encoded) fail(`No image data. Raw: ${JSON.stringify(data).slice(0, 400)}`);
    return { bytes: Buffer.from(p.bytesBase64Encoded, 'base64'), contentType: p.mimeType ?? 'image/png' };
  }
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) fail(`No inline image. Raw: ${JSON.stringify(data).slice(0, 400)}`);
  return { bytes: Buffer.from(inline.data, 'base64'), contentType: inline.mimeType ?? 'image/png' };
}

async function catalogHit(reuseKey: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cue_images?select=reuse_key&reuse_key=eq.${reuseKey}&limit=1`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  if (!res.ok) fail(`Catalog lookup failed: ${res.status} ${await res.text()}`);
  return (await res.json()).length > 0;
}

async function store(reuseKey: string, prompt: string, bytes: Buffer, contentType: string) {
  const path = `${reuseKey}.png`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!up.ok) fail(`Bucket upload failed: ${up.status} ${await up.text()}\n(Is the "${BUCKET}" bucket created? See migration 006 / SETUP step 4b.)`);

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/cue_images`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      reuse_key: reuseKey,
      sport_key: 'bjj',
      target_position: targetPosition || null,
      prompt,
      storage_path: path,
      provider: 'gemini',
    }),
  });
  if (!ins.ok) fail(`Catalog insert failed: ${ins.status} ${await ins.text()}`);
}

async function main() {
  if (!GEMINI_API_KEY) fail('Set GEMINI_API_KEY (or EXPO_PUBLIC_GEMINI_API_KEY).');

  const reuseKey = deriveCueImageKey({ sportKey: 'bjj', targetPosition, cue });
  const prompt = buildCueImagePrompt({ cue, targetPosition, styleHint: BJJ_IMAGE_STYLE_HINT });

  console.log(`\ncue:        "${cue}"`);
  console.log(`position:   "${targetPosition}"`);
  console.log(`model:      ${IMAGE_MODEL}`);
  console.log(`reuse key:  ${reuseKey}`);

  if (upload) {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      fail('--upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    if (await catalogHit(reuseKey)) {
      const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${reuseKey}.png`;
      console.log(`\n♻️  CACHE HIT — already in the catalog, no generation.`);
      console.log(`public url: ${url}\n`);
      return;
    }
  }

  console.log(`\n⏳ generating…`);
  const { bytes, contentType } = await generate(prompt);
  const outFile = `cue-image-test.png`;
  writeFileSync(outFile, bytes);
  console.log(`✅ generated ${bytes.length} bytes (${contentType}) → ${outFile}`);
  console.log(`   open it:  open ${outFile}`);

  if (upload) {
    await store(reuseKey, prompt, bytes, contentType);
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${reuseKey}.png`;
    console.log(`\n✅ uploaded + indexed.`);
    console.log(`public url: ${url}`);
    console.log(`   (re-run the same command → should print CACHE HIT)\n`);
  }
}

main().catch((e) => fail(String(e?.stack ?? e)));
