#!/usr/bin/env node
/**
 * Diagnose a failing analysis pipeline.
 *
 *   scripts/diagnose-gemini.sh
 *
 * Answers two questions in one run, because both produce the same
 * user-facing message ("The analysis service hiccuped"):
 *
 *   1. Is the model the server uses still available to this key?
 *   2. Does the real extraction prompt still come back as parseable JSON?
 *
 * Reads GEMINI_API_KEY from the environment or .env. Makes read-only calls.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BJJ_EXTRACTION_PROMPT } from '../src/sports/bjj/bjjPrompts.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Mirrors supabase/functions/_shared/ai.ts: envOr('GEMINI_MODEL', 'gemini-2.5-flash')
const SERVER_DEFAULT = 'gemini-2.5-flash';

function loadDotEnv() {
  const p = join(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (!k || process.env[k]) continue;
    const val = (v ?? '').replace(/^['"]|['"]$/g, '').trim();
    if (val) process.env[k] = val;
  }
}

const SAMPLE =
  'Today I rolled five rounds. I kept getting stuck under side control and ' +
  'I could not frame before he got the crossface. My guard retention felt slow.';

async function main() {
  loadDotEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('error: GEMINI_API_KEY not set (shell or .env).');
    process.exit(1);
  }
  const model = process.argv[2] ?? SERVER_DEFAULT;

  // ── 1. availability ──────────────────────────────────────────────────────
  console.error(`\n1. Is "${model}" available to this key?\n`);
  const listRes = await fetch(
    `${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`,
  );
  if (!listRes.ok) {
    console.error(`   could not list models: ${listRes.status}`);
  } else {
    const j = (await listRes.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const usable = (j.models ?? [])
      .filter((m) =>
        (m.supportedGenerationMethods ?? []).includes('generateContent'),
      )
      .map((m) => (m.name ?? '').replace(/^models\//, ''));
    const has = usable.includes(model);
    console.error(
      `   ${has ? 'YES — the model is available' : 'NO  — THE MODEL IS NOT AVAILABLE'}`,
    );
    if (!has) {
      console.error(`\n   models this key CAN use for generateContent:`);
      for (const m of usable.filter((m) => m.startsWith('gemini')))
        console.error(`     ${m}`);
    }
  }

  // ── 2. does the real prompt still parse? ─────────────────────────────────
  console.error(
    `\n2. Does the real extraction prompt return parseable JSON?\n`,
  );
  const prompt = BJJ_EXTRACTION_PROMPT.replaceAll('{{TRANSCRIPT}}', SAMPLE)
    .replaceAll('{{BELT_LEVEL}}', 'Blue Belt')
    .replaceAll('{{SKILL_LEVEL}}', 'Blue Belt')
    .replaceAll(
      '{{SENTIMENT_LABELS}}',
      'frustrated, flat, neutral, encouraged, breakthrough',
    );
  console.error(`   prompt is ~${Math.round(prompt.length / 4)} tokens`);

  const res = await fetch(
    `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Same settings the edge function uses for extraction.
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  if (!res.ok) {
    console.error(`   HTTP ${res.status}`);
    console.error(`   ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const j = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const c = j.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  console.error(`   finishReason: ${c?.finishReason ?? '(none)'}`);
  console.error(`   text length : ${text.length}`);
  if (!text) {
    console.error('   !! EMPTY RESPONSE — this is what breaks the pipeline');
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    console.error('   JSON parses OK. Fields returned:');
    for (const k of Object.keys(parsed))
      console.error(`     ${k}: ${JSON.stringify(parsed[k]).slice(0, 70)}`);
  } catch (e) {
    console.error(`   !! MALFORMED JSON — ${String(e).slice(0, 120)}`);
    console.error(`   first 300 chars: ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.error('');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
