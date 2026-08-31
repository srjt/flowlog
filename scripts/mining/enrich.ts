#!/usr/bin/env node
/**
 * Second pass: fill `counter` and `opponent` on records that left them empty.
 *
 *   scripts/mining/enrich.sh <records-dir> --provider ollama --model qwen3:32b
 *   scripts/mining/enrich.sh <records-dir> --dry-run
 *   scripts/mining/enrich.sh <records-dir> --only <slug>
 *
 * These two fields are the whole quality gap between a local run and a paid
 * one. Over 88 volumes the local model filled `counter` on 21% of records
 * against Gemini's 34%, and `opponent` on 62% against 79% — and unlike quote
 * fidelity, no post-processing fixes it, because the information is missing
 * rather than mangled.
 *
 * It does NOT need the transcript re-read from scratch. The record already
 * says which moment it came from, so this re-reads only the window around it
 * and asks one narrow question. That is the cheap half of mining.
 *
 * THE THING THIS MUST NOT DO IS GUESS. A model handed a prescription and
 * asked "what is the counter?" will answer from jiu-jitsu knowledge, and the
 * answer will be plausible, unattributable, and wrong often enough to poison
 * the store. So every addition must come back with EVIDENCE — a verbatim span
 * from the window — and an addition whose evidence is not found in the
 * transcript is discarded. The check is the same one `repairQuote` uses, and
 * it is mechanical: no judgement, no second opinion.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

import { parseTranscript, type TranscriptLine } from './transcript.ts';
import { applyCorrections } from './prompt.ts';
import { repairQuote, type MinedRecord } from './records.ts';
import { volumeNumbersForDirectory } from './volumes.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (f: string) => process.argv.includes(f);
function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Seconds of transcript either side of a record's timestamp. */
const WINDOW = 120;
/** Records per model call. Small enough that the window stays relevant. */
const BATCH = 6;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const seriesName = (d: string) =>
  basename(d)
    .replace(/:.*$/, '')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function indexLibrary(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      if (statSync(join(dir, e)).isDirectory()) walk(join(dir, e));
    }
    const txts = entries.filter(
      (e) =>
        !e.startsWith('.') &&
        e.toLowerCase().endsWith('.txt') &&
        !/^contents?\.txt$/i.test(e),
    );
    const numbers = volumeNumbersForDirectory(
      txts.map((e) => e.replace(/\.txt$/i, '')),
    );
    for (const e of txts) {
      const p = join(dir, e);
      if (!/^\[\d+:\d{2}:\d{2}/m.test(readFileSync(p, 'utf8').slice(0, 4000)))
        continue;
      const vol = numbers.get(e.replace(/\.txt$/i, '')) ?? null;
      if (vol === null) continue;
      out.set(`${slugify(seriesName(dir))}-v${vol}`, p);
    }
  };
  walk(root);
  return out;
}

function windowText(lines: TranscriptLine[], at: number): string {
  return lines
    .filter(
      (l) => l.startSeconds >= at - WINDOW && l.startSeconds <= at + WINDOW,
    )
    .map((l) => applyCorrections(l.text))
    .join(' ');
}

export function buildEnrichPrompt(
  records: MinedRecord[],
  windows: string[],
): string {
  const items = records
    .map(
      (r, i) => `--- RECORD ${i + 1}  (id ${r.id})
position: ${r.position}
prescription: ${r.prescription}
detail: ${r.detail}
currently counter: ${r.counter || '(EMPTY)'}
currently applies-when: ${r.preconditions.opponent || '(EMPTY)'}

TRANSCRIPT AROUND THIS MOMENT:
${windows[i]}
`,
    )
    .join('\n');

  return `You are filling two missing fields on records already extracted from a Brazilian Jiu-Jitsu instructional.

This is EXTRACTION, not recall. You know jiu-jitsu; do not use it. Report only what the transcript passage in front of you actually says. If the passage does not say it, leave the field empty — an empty field is correct and useful, an invented one is worse than nothing.

FOR EACH RECORD, fill only the fields currently marked (EMPTY):

"counter" — what the OPPONENT does to stop this, if the instructor says it. It is not your next step: "then you switch to the far-side armbar" is not a counter; "he hides the far arm, so you switch" is — the counter is the hiding. Look for:
  - the opponent's reaction:  "he'll base out with his free hand"
  - the conditional failure:  "if he posts, this won't work"
  - the thing you must beat:  "his whole job is to get that underhook back"
  - the pre-emption:          "before he can bring his knee in, you have to..."
The counter is often spoken BEFORE the technique, as the reason for it.

"opponent" — what the opponent must be doing for this prescription to apply: their posture, their grips, their weight, the reaction they just gave you.

WRITE IT AS A CONDITION, NOT A QUOTE. A short phrase, under fifteen words, in your own words:
  GOOD: "has both arms on the outside"
  GOOD: "posts his free hand on the mat as you bridge"
  BAD:  "arms are on the outside just like so do you remember the phrase that we always use from bottom position everything inside okay"
The second is a transcript excerpt pasted into the field. That belongs in "opponentEvidence", never in "opponent".

EVIDENCE IS REQUIRED. For every field you fill, quote the words from the passage that say it, VERBATIM. Copy the characters; do not tidy or join separate moments. An addition whose evidence cannot be found in the transcript is discarded, so an unsupported guess is wasted effort.

Return STRICT JSON, an array, one object per record you are changing. Omit records you are not changing.

[
  {
    "id": string,               // the record id, exactly as given
    "counter": string,          // omit or "" if the passage does not say
    "counterEvidence": string,  // verbatim words backing "counter"
    "opponent": string,         // omit or "" if the passage does not say
    "opponentEvidence": string  // verbatim words backing "opponent"
  }
]

${items}`;
}

interface Enrichment {
  id?: unknown;
  counter?: unknown;
  counterEvidence?: unknown;
  opponent?: unknown;
  opponentEvidence?: unknown;
}

/**
 * Keep an addition only if its evidence is really in the transcript.
 *
 * `repairQuote` already answers "is this span verbatim here", and reusing it
 * means the enrichment gate and the mining gate cannot drift apart.
 */
function evidenceHolds(evidence: string, transcript: string): boolean {
  if (!evidence.trim()) return false;
  const fix = repairQuote(evidence, transcript);
  return !fix.unverifiable;
}

async function callOllama(
  prompt: string,
  model: string,
  budget: number,
): Promise<string> {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const promptTokens = Math.ceil((prompt.length / 4) * 1.25);
  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      options: {
        num_ctx: promptTokens + budget,
        num_predict: budget,
        temperature: 0.2,
        top_p: 0.9,
        repeat_penalty: 1.1,
      },
    }),
  });
  if (!res.ok) die(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { response?: string }).response ?? '';
}

function parseJsonArray(text: string): Enrichment[] {
  const cleaned = text
    .replace(/```json|```/g, '')
    .replace(/<\/?think>/g, '')
    .replace(/\/no_?think\b/g, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--'))
    die('usage: enrich.sh <records-dir> [--dry-run] [--only slug]');
  const recordsDir = dir.replace(/^~/, homedir());
  if (!existsSync(recordsDir)) die(`no such directory ${recordsDir}`);

  const model = arg('--model') ?? 'qwen3:32b';
  const dryRun = has('--dry-run');
  const only = arg('--only');
  const library = indexLibrary(
    join(homedir(), 'Documents', 'BJJ Instructionals'),
  );

  let considered = 0,
    proposed = 0,
    keptCounter = 0,
    keptOpponent = 0,
    rejected = 0,
    rejectedPaste = 0;

  for (const f of readdirSync(recordsDir).sort()) {
    if (!f.endsWith('.records.json')) continue;
    const slug = f.replace(/\.records\.json$/, '');
    if (only && !slug.includes(only)) continue;
    const transcriptPath = library.get(slug);
    if (!transcriptPath) continue;

    const records: MinedRecord[] = JSON.parse(
      readFileSync(join(recordsDir, f), 'utf8'),
    );
    const lines = parseTranscript(readFileSync(transcriptPath, 'utf8'));
    const whole = lines.map((l) => applyCorrections(l.text)).join(' ');

    const todo = records.filter(
      (r) =>
        !(r.counter ?? '').trim() || !(r.preconditions.opponent ?? '').trim(),
    );
    if (todo.length === 0) continue;
    considered += todo.length;
    console.error(
      `\n${slug}: ${todo.length} of ${records.length} records missing a field`,
    );
    if (dryRun) continue;

    const byId = new Map(records.map((r) => [r.id, r]));
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const windows = batch.map((r) =>
        windowText(lines, r.source.startSeconds),
      );
      const prompt = buildEnrichPrompt(batch, windows);
      const text = await callOllama(prompt, model, 1800);
      for (const e of parseJsonArray(text)) {
        const id = typeof e.id === 'string' ? e.id : '';
        const rec = byId.get(id);
        if (!rec) continue;
        proposed++;
        const counter = typeof e.counter === 'string' ? e.counter.trim() : '';
        const opponent =
          typeof e.opponent === 'string' ? e.opponent.trim() : '';
        if (counter && !(rec.counter ?? '').trim()) {
          if (evidenceHolds(String(e.counterEvidence ?? ''), whole)) {
            rec.counter = counter;
            keptCounter++;
          } else rejected++;
        }
        if (opponent && !(rec.preconditions.opponent ?? '').trim()) {
          // Two ways to fail, and the second is the one the prompt alone did
          // not prevent: the model pastes the evidence into the field instead
          // of summarising it, and a scope field full of raw transcript is
          // useless to the collision check it exists for. A condition written
          // in the model's own words is NOT verbatim in the transcript — so if
          // it is, it was pasted.
          const pasted = evidenceHolds(opponent, whole);
          const tooLong = opponent.split(/\s+/).length > 25;
          if (!evidenceHolds(String(e.opponentEvidence ?? ''), whole))
            rejected++;
          else if (pasted || tooLong) rejectedPaste++;
          else {
            rec.preconditions.opponent = opponent;
            keptOpponent++;
          }
        }
      }
      process.stderr.write(
        `\r  ${Math.min(i + BATCH, todo.length)}/${todo.length}   `,
      );
    }
    process.stderr.write('\n');
    copyFileSync(join(recordsDir, f), join(recordsDir, f + '.pre-enrich'));
    writeFileSync(
      join(recordsDir, f),
      JSON.stringify(records, null, 2) + '\n',
      'utf8',
    );
  }

  console.error(`\nrecords missing a field: ${considered}`);
  if (!dryRun) {
    console.error(`additions proposed:      ${proposed}`);
    console.error(`counter filled:          ${keptCounter}`);
    console.error(`opponent filled:         ${keptOpponent}`);
    console.error(`DISCARDED — evidence not in the transcript: ${rejected}`);
    console.error(
      `DISCARDED — scope field was a pasted excerpt:  ${rejectedPaste}`,
    );
  } else {
    console.error(`\nDry run — no model called, nothing written.`);
  }
}

main().catch((e) => die(String(e?.stack ?? e)));
