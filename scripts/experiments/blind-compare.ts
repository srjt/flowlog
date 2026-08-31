#!/usr/bin/env node
/**
 * A blind review sheet: Gemini's record beside the local one, unlabelled.
 *
 *   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --sample 20
 *   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --key
 *
 * Costs nothing. Runs no model.
 *
 * Every number in `record-quality.sh` and `record-agreement.sh` is mechanical.
 * They establish that local records are well-formed, honestly quoted and
 * scoped — they cannot establish that a record TEACHES THE RIGHT THING. Only a
 * person who knows jiu-jitsu can say that, and the whole point of committing
 * to local mining is that nobody will read 800 volumes. So read twenty pairs.
 *
 * Blind on purpose. Knowing which side is the paid model decides the question
 * before the reading starts, and the honest answer here is genuinely in doubt:
 * the two models agree on the moment only about 42% of the time, and where
 * they disagree they are usually both right about different things. A labelled
 * sheet would measure loyalty to Gemini rather than quality.
 *
 * Pairs are matched on position and timestamp, so both sides describe the same
 * moment of the same video and the comparison is fair. Sides are shuffled per
 * pair by a seeded coin, and `--key` prints the answers afterwards.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { MinedRecord } from '../mining/records.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (f: string) => process.argv.includes(f);

const MOMENT_WINDOW = 60;

/**
 * Deterministic shuffle. The sheet and the key must agree about which side is
 * which, and they are produced by separate runs — so the coin is derived from
 * the pair's own id rather than from `Math.random`.
 */
function coin(seed: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) & 1) === 1;
}

function load(dir: string): Map<string, MinedRecord[]> {
  const out = new Map<string, MinedRecord[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.records.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out.set(
      f.replace(/\.records\.json$/, ''),
      Array.isArray(raw) ? raw : (raw.records ?? []),
    );
  }
  return out;
}

interface Pair {
  slug: string;
  position: string;
  timestamp: string;
  gemini: MinedRecord;
  local: MinedRecord;
}

/** One pair per Gemini record that has a local counterpart at the same moment. */
function pairs(
  ref: Map<string, MinedRecord[]>,
  cand: Map<string, MinedRecord[]>,
): Pair[] {
  const out: Pair[] = [];
  for (const [slug, refRecs] of ref) {
    const candRecs = cand.get(slug);
    if (!candRecs) continue;
    const used = new Set<number>();
    for (const r of refRecs) {
      let best = { i: -1, d: Infinity };
      candRecs.forEach((c, i) => {
        if (used.has(i) || c.position !== r.position) return;
        const d = Math.abs(c.source.startSeconds - r.source.startSeconds);
        if (d <= MOMENT_WINDOW && d < best.d) best = { i, d };
      });
      if (best.i === -1) continue;
      used.add(best.i);
      out.push({
        slug,
        position: r.position,
        timestamp: r.source.timestamp,
        gemini: r,
        local: candRecs[best.i]!,
      });
    }
  }
  return out;
}

/** Evenly spaced rather than random: one volume must not dominate the sheet. */
function sample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!);
}

function card(r: MinedRecord, label: string): string {
  const p = r.preconditions;
  return [
    `  ### ${label}`,
    `  prescription : ${r.prescription}`,
    `  why          : ${r.why}`,
    `  detail       : ${r.detail || '(empty)'}`,
    `  counter      : ${r.counter || '(empty)'}`,
    `  applies when : ${p.opponent || '(unconditional)'}`,
    `  gi / level   : ${p.gi} / ${p.level}`,
    `  quote        : "${r.quote}"${r.quoteRepaired ? '   [trimmed to a verbatim span]' : ''}`,
  ].join('\n');
}

function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error(
      'usage: blind-compare.sh <local-records-dir> [--reference DIR] [--sample N] [--key] [--out FILE]',
    );
    process.exit(1);
  }
  const candDir = resolve(dir);
  if (!existsSync(candDir)) {
    console.error(`error: no such directory ${candDir}`);
    process.exit(1);
  }
  // The reference defaults to the mined corpus, but a fair sheet needs BOTH
  // sides produced by the current prompt — the corpus was mined by an older
  // one, and comparing against it would score the prompt change rather than
  // the model.
  const refDir = resolve(
    arg('--reference') ?? join(homedir(), 'flowlog-records'),
  );
  if (!existsSync(refDir)) {
    console.error(`error: no such reference directory ${refDir}`);
    process.exit(1);
  }
  const ref = load(refDir);
  const all = pairs(ref, load(candDir));
  const n = Number(arg('--sample') ?? '20');
  const chosen = sample(all, n);

  if (has('--key')) {
    console.error(
      `\nANSWER KEY — ${basename(candDir)} vs ${basename(refDir)}\n`,
    );
    chosen.forEach((p, i) => {
      const flipped = coin(`${p.slug}#${p.timestamp}#${p.position}`);
      console.error(
        `  ${String(i + 1).padStart(3)}.  A = ${flipped ? 'LOCAL ' : 'GEMINI'}   ` +
          `B = ${flipped ? 'GEMINI' : 'LOCAL '}   ${p.slug} @${p.timestamp}`,
      );
    });
    console.error('');
    return;
  }

  const lines: string[] = [
    `BLIND REVIEW SHEET — ${chosen.length} of ${all.length} matched pairs`,
    '',
    'Both cards in a pair describe the SAME moment of the SAME video. One was',
    'written by the paid model, one by the local model, in a different order',
    'each time. For each pair mark A, B, EQUAL, or BOTH BAD.',
    '',
    'What to judge — in this order:',
    '  1. Does the card match its quote? (the ten-second check)',
    '  2. Is the mechanic correct and specific enough to act on?',
    '  3. Does "applies when" actually scope it?',
    '',
    `Reference: ${basename(refDir)}    Candidate: ${basename(candDir)}`,
    'Run with --key afterwards to reveal which side was which.',
    '',
    '='.repeat(72),
  ];

  chosen.forEach((p, i) => {
    const flipped = coin(`${p.slug}#${p.timestamp}#${p.position}`);
    const [a, b] = flipped ? [p.local, p.gemini] : [p.gemini, p.local];
    lines.push(
      '',
      `## ${i + 1}.  ${p.position}   @${p.timestamp}`,
      '',
      card(a, 'A'),
      '',
      card(b, 'B'),
      '',
      '  verdict: [ A / B / EQUAL / BOTH BAD ]    notes:',
      '',
      '-'.repeat(72),
    );
  });

  const out =
    arg('--out') ?? join(homedir(), 'flowlog-records', 'blind-review.txt');
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.error(`\n${chosen.length} pairs written to:\n  ${out}\n`);
  console.error(`Matched pairs available: ${all.length}`);
  // Echo the FULL command including --reference: the key must be generated
  // from the same pair set, and omitting the reference silently reveals a
  // different sheet's answers.
  const refFlag = arg('--reference')
    ? ` --reference ${arg('--reference')}`
    : '';
  console.error(
    `Reveal with:  scripts/experiments/blind-compare.sh ${dir}${refFlag} --sample ${n} --key\n`,
  );
}

main();
