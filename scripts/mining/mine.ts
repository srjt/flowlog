#!/usr/bin/env node
/**
 * Mine one instructional volume into structured records.
 *
 *   scripts/mining/mine.ts "<volume.txt>" --instructor "John Danaher" \
 *     --instructional "GFF Escapes" --volume 2
 *
 *   scripts/mining/mine.ts <volume.txt> ... --dry-run     # assemble, don't call
 *   scripts/mining/mine.ts <volume.txt> ... --from-json r.json  # reprocess a saved response
 *
 * Runs on Node's native TypeScript support (Node 22.6+), so it imports the
 * canonical position taxonomy directly rather than keeping a second copy.
 *
 * Requires ANTHROPIC_API_KEY for a real run. Records are written OUTSIDE the
 * repo (default ~/flowlog-records) — they contain verbatim instructional text
 * and must never be committed.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';

import {
  assignIds,
  chapterCoverage,
  validateRecords,
  type MinedRecord,
} from './records.ts';
import { buildMiningPrompt } from './prompt.ts';
import {
  chapterAt,
  chaptersForVolume,
  parseChapterIndex,
  parseTranscript,
  type Chapter,
} from './transcript.ts';

/**
 * Provider defaults. The project runs on either Claude or Gemini (`AI_PROVIDER`
 * in the app); the miner mirrors that rather than assuming one.
 *
 * Mining is a one-off, quality-critical extraction over a whole volume, so the
 * stronger model is the right default — `.env.example` already documents
 * `gemini-2.5-pro` as the step up from the app's `gemini-2.5-flash` default.
 */
const DEFAULT_MODEL = {
  // gemini-2.5-pro is retired for new keys; the API's own 404 names this as
  // the replacement. Model availability differs per key, so do not guess —
  // `--list-models` asks the API what this key can actually use.
  gemini: 'gemini-3.1-pro-preview',
  claude: 'claude-opus-4-6',
} as const;
const MAX_TOKENS = 32000;

type Provider = keyof typeof DEFAULT_MODEL;

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string) => process.argv.includes(flag);

/**
 * Find a chapter index sitting beside the volume, if the title ships one.
 *
 * Naming is inconsistent across the library — `Contents.txt`, `Content.txt`,
 * or the instructional's full title as the filename. So try the conventional
 * names first, then fall back to any sibling .txt that actually PARSES as an
 * index: several timestamped `MM:SS - Title` lines and no transcript
 * timestamps. Cheap, and it keeps the completeness check available on more
 * titles instead of silently going missing because of a filename.
 */
function findChapterIndex(volumePath: string): string | null {
  const dir = dirname(volumePath);
  for (const name of [
    'Contents.txt',
    'contents.txt',
    'Content.txt',
    'content.txt',
  ]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  let best: { path: string; chapters: number } | null = null;
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt')) continue;
    const p = join(dir, entry);
    if (p === volumePath) continue;
    let text: string;
    try {
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    // A transcript, not an index — transcripts carry [h:mm:ss -> ...] lines.
    if (/^\[\d+:\d{2}:\d{2}/m.test(text)) continue;
    const chapters = parseChapterIndex(text).length;
    if (chapters >= 5 && (!best || chapters > best.chapters)) {
      best = { path: p, chapters };
    }
  }
  return best?.path ?? null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Read keys from a local .env if present, without clobbering anything already
 * exported. Keeps the miner usable without re-exporting secrets per shell;
 * .env is gitignored.
 */
function loadDotEnv(): void {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, rawValue] = m;
    if (!k || process.env[k]) continue;
    const v = (rawValue ?? '').replace(/^['"]|['"]$/g, '').trim();
    if (v) process.env[k] = v;
  }
}

/**
 * Ask the API which models this key can actually use.
 *
 * Model availability changes and differs per key — gemini-2.5-pro was retired
 * for new keys mid-project. Guessing an id from memory produces a confusing
 * 404; this asks.
 */
async function listGeminiModels(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) die('GEMINI_API_KEY is not set.');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
  );
  if (!res.ok)
    die(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    models?: {
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
      outputTokenLimit?: number;
    }[];
  };
  const usable = (json.models ?? []).filter((m) =>
    (m.supportedGenerationMethods ?? []).includes('generateContent'),
  );
  console.error(`\n${usable.length} models support generateContent:\n`);
  for (const m of usable) {
    const id = (m.name ?? '').replace(/^models\//, '');
    const out = m.outputTokenLimit ? `  out<=${m.outputTokenLimit}` : '';
    console.error(`  ${id.padEnd(42)}${out}  ${m.displayName ?? ''}`);
  }
  console.error(`\nPass one with --model <id>.\n`);
}

/** Which provider to use: explicit flag, else whichever key is available. */
function resolveProvider(): Provider {
  const explicit = arg('--provider');
  if (explicit === 'gemini' || explicit === 'claude') return explicit;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  die(
    'No API key found. Set GEMINI_API_KEY (or ANTHROPIC_API_KEY), in your\n' +
      '  shell or in .env.\n' +
      '  Or use --dry-run to assemble the prompt without calling the API,\n' +
      '  or --from-json <file> to reprocess a saved response.',
  );
}

/**
 * Gemini, in JSON mode. `responseMimeType: application/json` makes the model
 * return parseable JSON rather than fenced prose, which removes a whole class
 * of parse failure. Mirrors the edge function's call shape.
 */
async function callGemini(prompt: string, model: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        // Extraction, not composition — keep it faithful to the transcript.
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    if (res.status === 404) {
      die(
        `Gemini API 404 — the model "${model}" is not available to this key.\n` +
          `  Run with --list-models to see what is, then pass --model <id>.\n\n  ${body}`,
      );
    }
    die(`Gemini API ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');
  if (!text) {
    die(
      `Gemini returned no text (finishReason: ${candidate?.finishReason ?? 'unknown'}). ` +
        `If this is MAX_TOKENS the volume produced more records than the output cap allows.`,
    );
  }
  return text;
}

async function callClaude(prompt: string, model: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    die(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    content: { type: string; text?: string }[];
  };
  return json.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

/** Models sometimes fence JSON despite instructions. */
export function parseModelJson(text: string): unknown[] {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) {
    die('model response contained no JSON array');
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) die('model response was not an array');
  return parsed;
}

async function main() {
  loadDotEnv();

  if (has('--list-models')) {
    await listGeminiModels();
    return;
  }

  const volumePath = process.argv[2];
  if (!volumePath || volumePath.startsWith('--')) {
    die(
      'usage: mine.ts <volume.txt> --instructor X --instructional Y --volume N',
    );
  }
  if (!existsSync(volumePath)) die(`no such file: ${volumePath}`);

  const instructor = arg('--instructor') ?? 'Unknown';
  const instructional = arg('--instructional') ?? basename(dirname(volumePath));
  const volume = Number(arg('--volume') ?? '1');
  const outDir = arg('--out') ?? join(homedir(), 'flowlog-records');

  const lines = parseTranscript(readFileSync(volumePath, 'utf8'));
  if (lines.length === 0) die('transcript parsed to zero lines');

  let chapters: Chapter[] = [];
  const indexPath = arg('--chapters') ?? findChapterIndex(volumePath);
  if (indexPath && existsSync(indexPath)) {
    chapters = chaptersForVolume(
      parseChapterIndex(readFileSync(indexPath, 'utf8')),
      volume,
    );
  }

  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  console.error(
    `\n${instructional} vol ${volume} — ${lines.length} segments, ~${words} words, ` +
      `${chapters.length} chapters${chapters.length ? '' : ' (no index — records will be untagged)'}`,
  );

  const prompt = buildMiningPrompt(
    { instructor, instructional, volume },
    lines,
    chapters,
  );
  console.error(`prompt: ~${Math.round(prompt.length / 4)} tokens`);

  if (has('--dry-run')) {
    const promptOut = join(
      outDir,
      `${slugify(instructional)}-v${volume}.prompt.txt`,
    );
    mkdirSync(outDir, { recursive: true });
    writeFileSync(promptOut, prompt, 'utf8');
    console.error(
      `\nDRY RUN — no API call. Prompt written to:\n  ${promptOut}\n`,
    );
    return;
  }

  const fromJson = arg('--from-json');
  let responseText: string;
  if (fromJson) {
    responseText = readFileSync(fromJson, 'utf8');
  } else {
    const provider = resolveProvider();
    const model = arg('--model') ?? DEFAULT_MODEL[provider];
    console.error(`calling ${provider} (${model})…`);
    responseText =
      provider === 'gemini'
        ? await callGemini(prompt, model)
        : await callClaude(prompt, model);
  }

  const raw = parseModelJson(responseText);
  const slug = `${slugify(instructional)}-v${volume}`;

  const { valid, rejected } = validateRecords(
    raw as never[],
    { instructor, instructional, volume },
    (seconds) => chapterAt(chapters, seconds)?.title ?? null,
  );
  const records: MinedRecord[] = assignIds(valid, slug);

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.records.json`);
  writeFileSync(outPath, JSON.stringify(records, null, 2) + '\n', 'utf8');
  if (!fromJson) {
    writeFileSync(join(outDir, `${slug}.response.json`), responseText, 'utf8');
  }

  report(records, rejected, chapters, outPath);
}

function report(
  records: MinedRecord[],
  rejected: { index: number; reason: string; offending: unknown }[],
  chapters: Chapter[],
  outPath: string,
) {
  console.error(`\nRECORDS  ${records.length}   ->  ${outPath}`);

  if (rejected.length) {
    // Loudly, not silently: a miner that quietly discards a third of its
    // output looks like it worked.
    console.error(`\nREJECTED ${rejected.length}`);
    const byReason = new Map<string, number>();
    for (const r of rejected) {
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    }
    for (const [reason, n] of byReason) console.error(`  ${n}x  ${reason}`);
    console.error('  examples:');
    for (const r of rejected.slice(0, 3)) {
      console.error(
        `    #${r.index}: ${JSON.stringify(r.offending)?.slice(0, 90)}`,
      );
    }
  }

  const byPosition = new Map<string, number>();
  for (const r of records) {
    byPosition.set(r.position, (byPosition.get(r.position) ?? 0) + 1);
  }
  console.error('\nBY POSITION');
  for (const [p, n] of [...byPosition].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(3)}  ${p}`);
  }

  if (chapters.length) {
    const coverage = chapterCoverage(records, chapters);
    const empty = coverage.filter((c) => c.recordCount === 0);
    console.error(
      `\nCOMPLETENESS  ${coverage.length - empty.length}/${coverage.length} chapters produced records`,
    );
    if (empty.length) {
      // The visible symptom of a model summarising rather than exhausting.
      console.error('  chapters with NO records:');
      for (const c of empty) console.error(`    ${c.title}`);
    }
  } else {
    console.error('\nCOMPLETENESS  no chapter index — cannot check coverage');
  }

  console.error('\nSPOT-CHECK  three records, verify each against its quote:');
  for (const r of records.slice(0, 3)) {
    console.error(`\n  ${r.id}  [${r.position}]  ${r.source.timestamp}`);
    console.error(`    prescription: ${r.prescription}`);
    console.error(`    quote:        "${r.quote.slice(0, 140)}"`);
  }
  console.error('');
}

main().catch((err) => die(String(err?.stack ?? err)));
