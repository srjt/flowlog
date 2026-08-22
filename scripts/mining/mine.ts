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

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 32000;

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string) => process.argv.includes(flag);

/** Find a chapter index sitting beside the volume, if the title ships one. */
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
  // Some titles keep the index in a differently-named .txt alongside the
  // volumes; fall back to any .txt that parses as an index.
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function callClaude(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    die(
      'ANTHROPIC_API_KEY is not set.\n' +
        '  Use --dry-run to assemble the prompt without calling the API,\n' +
        '  or --from-json <file> to reprocess a saved response.',
    );
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
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
  const responseText = fromJson
    ? readFileSync(fromJson, 'utf8')
    : await callClaude(prompt);

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
