#!/usr/bin/env node
/**
 * Do two contradicting absolutes ever reach the same prompt? (#102 / #100)
 *
 *   scripts/experiments/collisions.sh
 *
 * Costs nothing. Runs no model.
 *
 * A LONE unscoped absolute is harmless — the model weighs one instruction
 * against its neighbours. The damage needs TWO on the same position, each
 * stating something unconditional, with nothing to say which applies. That is
 * the knee-shield pair: "do not connect knee and elbow" beside "always connect
 * knee and elbow", neither naming which knee shield it means.
 *
 * IMPORTANT — this counts CO-OCCURRENCE, not contradiction. Two unscoped
 * absolutes on one position may agree perfectly; "build a straight-spine half
 * guard game" and "do not bridge to the outside" are compatible advice and
 * this reports them as a hit. Deciding whether two instructions actually
 * conflict needs a reader, not a pattern.
 *
 * So treat a non-zero count as "go and look", not as "there is a bug". It is a
 * cheap screen for a condition that is expensive to check properly, and its
 * value is that zero is genuinely informative.
 *
 * Run this before and after mining a new title. Mining more of a systematised
 * instructor raises the odds — his material skews toward absolutes — so a
 * count that moves off zero is the signal to stop and re-mine with the
 * corrected prompt rather than keep adding.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { candidatePositions, rankRecords } from '../../src/sports/grounding.ts';
import { isUnscopedAbsolute } from '../mining/records.ts';

interface Rec {
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  unscoped: boolean;
}

function loadRecords(): Rec[] {
  const dir = join(homedir(), 'flowlog-records');
  const out: Rec[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.records.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const r of Array.isArray(raw) ? raw : (raw.records ?? [])) {
      const pre = r.preconditions ?? {};
      const shaped = {
        prescription: r.prescription ?? '',
        preconditions: { opponent: pre.opponent ?? '' },
      };
      out.push({
        position: r.position,
        prescription: r.prescription ?? '',
        why: r.why ?? '',
        detail: r.detail ?? '',
        counter: r.counter ?? '',
        gi: pre.gi ?? 'either',
        level: pre.level ?? 'any',
        opponent: pre.opponent ?? '',
        unscoped: isUnscopedAbsolute(shaped),
      });
    }
  }
  return out;
}

function main(): void {
  const basePath = join(homedir(), 'flowlog-baseline', 'baseline.json');
  if (!existsSync(basePath)) {
    console.error(`\n  No baseline at ${basePath}\n`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(basePath, 'utf8'));
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? []);
  const records = loadRecords();

  let grounded = 0;
  let withOne = 0;
  const collisions: string[] = [];

  for (const s of sessions) {
    const extraction = {
      positionsVisited: s.positions_visited ?? [],
      keyMistake: s.key_mistake ?? '',
      opponentAction: s.opponent_action ?? '',
      perspective: 'unknown' as const,
      rawTranscript: s.raw_transcript ?? '',
    };
    const ids = candidatePositions(extraction);
    if (ids.length === 0) continue;
    const top = rankRecords(
      records.filter((r) => ids.includes(r.position)),
      extraction.keyMistake,
    ) as Rec[];
    if (top.length === 0) continue;
    grounded++;

    const unscoped = top.filter((r) => r.unscoped);
    if (unscoped.length > 0) withOne++;

    const byPosition = new Map<string, Rec[]>();
    for (const u of unscoped) {
      byPosition.set(u.position, [...(byPosition.get(u.position) ?? []), u]);
    }
    for (const [pos, rs] of byPosition) {
      if (rs.length < 2) continue;
      collisions.push(
        `    ${pos}\n` +
          rs.map((r) => `      · ${r.prescription.slice(0, 88)}`).join('\n'),
      );
    }
  }

  console.log(`
  ABSOLUTE COLLISIONS (#102)
  ${'─'.repeat(64)}
  records in the review store                        ${records.length}
  ...unscoped absolutes                              ${records.filter((r) => r.unscoped).length}

  grounded baseline sessions                         ${grounded}
  ...injected set has >=1 unscoped absolute          ${withOne}
  ...has >=2 on ONE position  (WORTH READING)        ${collisions.length}
`);

  if (collisions.length === 0) {
    console.log(`  A lone unscoped absolute is harmless — the model weighs one
  instruction among many. Nothing currently contradicts itself inside
  a single prompt.

  Re-run after mining a new title. A count above zero is the signal to
  re-mine with the corrected prompt rather than keep adding.
`);
  } else {
    console.log(
      '  co-occurring, worth reading:\n' + collisions.join('\n') + '\n',
    );
    console.log(`  These reach the same cue with nothing to say which applies. They may
  well agree — this is co-occurrence, not proven contradiction. Read them
  before concluding anything, and re-mine only if they genuinely conflict.
`);
  }
}

main();
