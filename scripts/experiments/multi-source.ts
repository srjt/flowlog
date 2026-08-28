#!/usr/bin/env node
/**
 * Does a second instructional on the same position change what reaches the
 * prompt? (issue #99)
 *
 *   scripts/experiments/multi-source.sh
 *
 * Costs nothing. Runs no model.
 *
 * The expensive version of this question — generate both cues and judge them
 * blind — is only worth paying for if the two arms differ at all. Ranking is
 * keyword overlap with the mistake, and Gordon Ryan records are a small
 * minority of every shared position, so they may simply never survive into the
 * top N. If so the arms are identical, the blind trial would compare a thing
 * to itself, and the real question behind #100 is depth rather than blending.
 *
 * This measures that first.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { candidatePositions, rankRecords } from '../../src/sports/grounding.ts';

interface Rec {
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  instructor: string;
}

function loadReviewStore(): Rec[] {
  const dir = join(homedir(), 'flowlog-records');
  const out: Rec[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.records.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const recs = Array.isArray(raw) ? raw : (raw.records ?? []);
    for (const r of recs) {
      out.push({
        position: r.position,
        prescription: r.prescription ?? '',
        why: r.why ?? '',
        detail: r.detail ?? '',
        counter: r.counter ?? '',
        gi: r.preconditions?.gi ?? 'either',
        level: r.preconditions?.level ?? 'any',
        opponent: r.preconditions?.opponent ?? '',
        instructor: r.source?.instructor ?? '?',
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
  const all = loadReviewStore();

  const PRIMARY = 'John Danaher';
  let considered = 0;
  let couldMix = 0;
  let actuallyDiffers = 0;
  let mixedInjected = 0;
  const detail: string[] = [];

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

    const pool = all.filter((r) => ids.includes(r.position));
    if (pool.length === 0) continue;
    considered++;

    const others = pool.filter((r) => r.instructor !== PRIMARY);
    if (others.length === 0) continue;
    couldMix++;

    const single = rankRecords(
      pool.filter((r) => r.instructor === PRIMARY),
      extraction.keyMistake,
    );
    const multi = rankRecords(pool, extraction.keyMistake);

    const sameSet =
      single.length === multi.length &&
      single.every((r, i) => r.prescription === multi[i]?.prescription);
    if (!sameSet) actuallyDiffers++;

    const fromOthers = (multi as Rec[]).filter(
      (r) => r.instructor !== PRIMARY,
    ).length;
    if (fromOthers > 0) {
      mixedInjected++;
      detail.push(
        `    ${ids.join(',').padEnd(30)} single=${single.length} multi=${multi.length} (${fromOthers} from a second instructor)`,
      );
    }
  }

  // Preconditions are the mechanism that lets the model choose between records
  // that would otherwise conflict. Where they are blank, two records can give
  // opposite instructions with nothing to tell them apart — and that happens
  // WITHIN one instructor, not only across two.
  const byPos = new Map<string, { n: number; blank: number }>();
  for (const r of all) {
    const e = byPos.get(r.position) ?? { n: 0, blank: 0 };
    e.n++;
    if (!r.opponent.trim()) e.blank++;
    byPos.set(r.position, e);
  }

  console.log(`
  MULTI-SOURCE EFFECT ON THE INJECTED SET (#99)
  ${'─'.repeat(64)}
  baseline sessions with a resolvable, covered position   ${considered}
  ...where a second instructor has records for it         ${couldMix}
  ...where the injected set actually CHANGES              ${actuallyDiffers}
  ...where a second instructor's record is injected       ${mixedInjected}
`);
  if (detail.length) {
    console.log('  sessions whose prompt would mix instructors:');
    console.log(detail.join('\n'));
    console.log('');
  }
  const thin = [...byPos.entries()]
    .filter(([, v]) => v.n >= 15 && v.blank / v.n >= 0.25)
    .sort((a, b) => b[1].blank / b[1].n - a[1].blank / a[1].n);
  if (thin.length) {
    console.log(`  Positions where records often carry NO precondition — the field the
  model uses to choose between conflicting advice:
`);
    for (const [pos, v] of thin) {
      console.log(
        `    ${pos.padEnd(32)}${String(v.blank).padStart(4)}/${String(v.n).padEnd(5)} (${Math.round((100 * v.blank) / v.n)}%)`,
      );
    }
    console.log(`
  Combining sources is only safe where preconditions distinguish them. These
  are the positions where they do not.
`);
  }

  if (mixedInjected === 0) {
    console.log(`  READ THIS: no session's prompt mixes instructors, so the blind
  trial would compare identical cues. Multi-source blending is not a
  risk on this data — the open question behind #100 is depth, not
  confusion.
`);
  }
}

main();
