#!/usr/bin/env node
/**
 * How close is a candidate miner to the one that mined the corpus?
 *
 *   scripts/experiments/record-agreement.sh ~/flowlog-records-q32 ~/flowlog-records-local-chunked
 *
 * Costs nothing. Runs no model.
 *
 * `record-quality.sh` scores each run against the transcript, which answers
 * "is this any good?" but NOT "is this the same?". Two miners can post nearly
 * identical summary tables while extracting different teaching points from
 * different minutes of the same video — the aggregates would hide it
 * completely.
 *
 * So compare against Gemini's own output directly, on three axes:
 *
 *   POSITION MIX   do they carve the volume into the same positions, in
 *                  roughly the same proportions?
 *   MOMENT RECALL  for each thing Gemini found, did the candidate find
 *                  something at that moment too? This is the closeness
 *                  measure — it asks whether the candidate would have
 *                  produced the corpus we already have.
 *   AGREEMENT      where both found the same moment, are they saying the
 *                  same thing about it?
 *
 * Recall matters more than precision here. A candidate with three times the
 * records is not thereby wrong — `record-quality.sh` already showed the extra
 * ones are distinct and quote real text. Extra records are a judgement call;
 * MISSING ones are a regression.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MinedRecord } from '../mining/records.ts';

/** Records within this many seconds are treated as the same moment. */
const MOMENT_WINDOW = 60;
/**
 * Overlap at or above this counts as "saying the same thing".
 *
 * Calibrated against real pairs, not picked. These two are the same teaching
 * point and any sane reader would say so:
 *
 *   "When the opponent applies a strong crossface, do not fight into it;
 *    instead, reach your whole hand over their crossfacing shoulder, give a
 *    quick pull, and move your chin off their shoulder."
 *   "Do not fight into a crossface; change the angle by taking your whole hand
 *    over the shoulder and moving your chin off it."
 *
 * Jaccard scores that pair 22% — it divides by the union, so one model simply
 * being wordier reads as disagreement. Containment over the SHORTER record
 * asks the question actually being asked: is the shorter one contained in the
 * longer? That scores the pair 69%.
 *
 * The threshold is the observed break, not a round number. Sorted containment
 * over one volume's pairs:
 *
 *   qwen3:32b   57 50 50 48 48 48 48 47 45 40 36 35 33 | 7 6
 *   30b-a3b     67 58 55 54 50 40 39 | 21 17 15
 *
 * Real pairs bunch above 33; below 21 are records that merely share a minute
 * of video. 0.5 would have cut straight through the middle of the genuine
 * matches and called most of them disagreements.
 */
const AGREE_AT = 0.3;

function loadDir(dir: string): Map<string, MinedRecord[]> {
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

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

/** Shared words as a fraction of the SHORTER record. See AGREE_AT. */
function containment(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / Math.min(A.size, B.size);
}

/**
 * Cosine similarity of two position→count distributions.
 *
 * Not a plain set overlap: a candidate that files 27 of 72 records under
 * `mount-bottom` where Gemini filed 3 of 24 has found the same positions and
 * still carved the volume differently. Cosine sees that; a set overlap does not.
 */
function positionSimilarity(a: MinedRecord[], b: MinedRecord[]): number {
  const count = (rs: MinedRecord[]) => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(r.position, (m.get(r.position) ?? 0) + 1);
    return m;
  };
  const A = count(a);
  const B = count(b);
  const keys = new Set([...A.keys(), ...B.keys()]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const x = A.get(k) ?? 0;
    const y = B.get(k) ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Agreement {
  label: string;
  volumes: number;
  refRecords: number;
  candRecords: number;
  positionSim: number[];
  /** Gemini records paired one-to-one with a candidate at the same moment. */
  recalled: number;
  /** ...where the pair also describes the same teaching point. */
  agreed: number;
  sims: number[];
  missedPositions: Set<string>;
  newPositions: Set<string>;
}

/**
 * Pair the two runs one-to-one, best match first.
 *
 * The obvious version — "for each Gemini record, is anything near it?" — is
 * biased toward whichever run emitted more records: three candidates within a
 * minute of a moment give three chances at a high score, and the MoE run has
 * three times the records of the Gemini one. It ranked FIRST under that
 * scoring and second under this, which is the whole reason this is greedy and
 * exclusive rather than nearest-neighbour.
 *
 * So every candidate record is spent at most once. Sort all admissible pairs
 * by similarity, take them in order, and skip any whose either half is already
 * taken. Recall is then a real recall and the extra records buy nothing.
 */
function pairOneToOne(
  refRecs: MinedRecord[],
  candRecs: MinedRecord[],
): { ri: number; ci: number; sim: number }[] {
  const pairs: { ri: number; ci: number; sim: number }[] = [];
  refRecs.forEach((r, ri) => {
    const rw = words(`${r.prescription} ${r.why}`);
    candRecs.forEach((c, ci) => {
      // Same position as well as same moment: one second of video can teach
      // both halves of an exchange, and calling those one record would
      // inflate every number here.
      if (c.position !== r.position) return;
      if (
        Math.abs(c.source.startSeconds - r.source.startSeconds) > MOMENT_WINDOW
      )
        return;
      pairs.push({
        ri,
        ci,
        sim: containment(rw, words(`${c.prescription} ${c.why}`)),
      });
    });
  });
  pairs.sort((a, b) => b.sim - a.sim);
  const usedRef = new Set<number>();
  const usedCand = new Set<number>();
  const taken: typeof pairs = [];
  for (const p of pairs) {
    if (usedRef.has(p.ri) || usedCand.has(p.ci)) continue;
    usedRef.add(p.ri);
    usedCand.add(p.ci);
    taken.push(p);
  }
  return taken;
}

function compare(
  ref: Map<string, MinedRecord[]>,
  cand: Map<string, MinedRecord[]>,
  label: string,
): Agreement {
  const a: Agreement = {
    label,
    volumes: 0,
    refRecords: 0,
    candRecords: 0,
    positionSim: [],
    recalled: 0,
    agreed: 0,
    sims: [],
    missedPositions: new Set(),
    newPositions: new Set(),
  };

  for (const [slug, refRecs] of ref) {
    const candRecs = cand.get(slug);
    if (!candRecs) continue;
    a.volumes++;
    a.refRecords += refRecs.length;
    a.candRecords += candRecs.length;
    a.positionSim.push(positionSimilarity(refRecs, candRecs));

    const refPos = new Set(refRecs.map((r) => r.position));
    const candPos = new Set(candRecs.map((r) => r.position));
    for (const p of refPos) if (!candPos.has(p)) a.missedPositions.add(p);
    for (const p of candPos) if (!refPos.has(p)) a.newPositions.add(p);

    for (const p of pairOneToOne(refRecs, candRecs)) {
      a.recalled++;
      a.sims.push(p.sim);
      if (p.sim >= AGREE_AT) a.agreed++;
    }
  }
  return a;
}

const pct = (n: number, d: number) =>
  d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function report(a: Agreement) {
  console.error(`\n${'-'.repeat(62)}\n${a.label}\n${'-'.repeat(62)}`);
  console.error(`  volumes compared        ${a.volumes}`);
  console.error(
    `  records  Gemini ${a.refRecords}  ->  candidate ${a.candRecords}  (${(a.candRecords / a.refRecords).toFixed(2)}x)`,
  );
  console.error(
    `  position mix similarity ${(mean(a.positionSim) * 100).toFixed(1)}%   (cosine over position counts)`,
  );
  console.error(
    `\n  MOMENT RECALL  ${pct(a.recalled, a.refRecords)}  — Gemini records paired with a candidate at the same moment`,
  );
  console.error(
    `  SAME POINT     ${pct(a.agreed, a.refRecords)}  — ...and describing the same teaching point`,
  );
  console.error(
    `  mean content overlap on paired records: ${(mean(a.sims) * 100).toFixed(1)}%`,
  );
  console.error(
    `\n  precision  ${pct(a.agreed, a.candRecords)}  — candidate records that reproduce a Gemini one`,
  );
  const f1 = a.agreed ? (2 * a.agreed) / (a.refRecords + a.candRecords) : 0;
  console.error(
    `  F1         ${(f1 * 100).toFixed(1)}%  — balances the two; a run cannot win it by emitting more`,
  );
  if (a.missedPositions.size) {
    console.error(
      `  positions Gemini found and this missed: ${[...a.missedPositions].join(', ')}`,
    );
  }
  if (a.newPositions.size) {
    console.error(
      `  positions this found and Gemini did not: ${[...a.newPositions].join(', ')}`,
    );
  }
}

function main() {
  const dirs = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (dirs.length === 0) {
    console.error(
      'usage: record-agreement.sh <candidate-records-dir> [more dirs...]',
    );
    process.exit(1);
  }
  const refDir = join(homedir(), 'flowlog-records');
  const ref = loadDir(refDir);
  console.error(`\nreference: ${refDir} (${ref.size} volumes, Gemini 3.1 Pro)`);

  const results: Agreement[] = [];
  for (const d of dirs) {
    const p = resolve(d);
    if (!existsSync(p)) {
      console.error(`  skip ${d} — no such directory`);
      continue;
    }
    const a = compare(ref, loadDir(p), basename(p));
    results.push(a);
    report(a);
  }

  if (results.length > 1) {
    console.error(`\n${'='.repeat(62)}\nCLOSEST TO GEMINI\n${'='.repeat(62)}`);
    console.error(
      `\n  ${'candidate'.padEnd(26)}${'recall'.padEnd(9)}${'precision'.padEnd(11)}${'F1'.padEnd(8)}pos mix`,
    );
    console.error(`  ${'-'.repeat(60)}`);
    // Ranked on F1. Recall alone rewards a run for emitting more records, and
    // precision alone rewards it for emitting fewer.
    const f1 = (a: Agreement) =>
      a.agreed ? (2 * a.agreed) / (a.refRecords + a.candRecords) : 0;
    for (const a of [...results].sort((x, y) => f1(y) - f1(x))) {
      console.error(
        `  ${a.label.slice(0, 24).padEnd(26)}` +
          `${pct(a.recalled, a.refRecords).padEnd(9)}` +
          `${pct(a.agreed, a.candRecords).padEnd(11)}` +
          `${(f1(a) * 100).toFixed(1) + '%'}`.padEnd(8) +
          `${(mean(a.positionSim) * 100).toFixed(1)}%`,
      );
    }
    console.error('');
  }
}

main();
