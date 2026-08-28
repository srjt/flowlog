#!/usr/bin/env node
/**
 * Find records that state an absolute without saying when it applies (#102).
 *
 *   scripts/experiments/unscoped-absolutes.sh          # summary
 *   scripts/experiments/unscoped-absolutes.sh --list   # every offender
 *
 * Costs nothing. Runs no model.
 *
 * Surfacing, not repairing. The scope is often sitting in the prose ("when
 * playing a low knee shield"), but lifting it with a pattern produced mangled
 * fragments — "When using a crab ride with two legs under your opponent's
 * legs, you must have a" — and a truncated clause in the field the prompt
 * tells the model to honour is worse than an empty one.
 *
 * Fixing these means re-mining the volume with the corrected prompt, or a
 * human rewriting the record. This says which.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isUnscopedAbsolute } from '../mining/records.ts';

interface Row {
  position: string;
  prescription: string;
  volume: string;
}

function main(): void {
  const dir = join(homedir(), 'flowlog-records');
  const offenders: Row[] = [];
  let total = 0;

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.records.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const recs = Array.isArray(raw) ? raw : (raw.records ?? []);
    for (const r of recs) {
      total++;
      const shaped = {
        prescription: r.prescription ?? '',
        preconditions: { opponent: r.preconditions?.opponent ?? '' },
      };
      if (isUnscopedAbsolute(shaped)) {
        offenders.push({
          position: r.position,
          prescription: r.prescription ?? '',
          volume: f.replace('.records.json', ''),
        });
      }
    }
  }

  const byPosition = new Map<string, number>();
  const byVolume = new Map<string, number>();
  for (const o of offenders) {
    byPosition.set(o.position, (byPosition.get(o.position) ?? 0) + 1);
    byVolume.set(o.volume, (byVolume.get(o.volume) ?? 0) + 1);
  }

  console.log(`
  UNSCOPED ABSOLUTES (#102)
  ${'─'.repeat(64)}
  records                                     ${total}
  state an absolute with no "applies when"    ${offenders.length} (${Math.round((100 * offenders.length) / total)}%)

  Small as a share, but these are the records most likely to be injected
  TOGETHER: an absolute about a position is dense in that position's
  vocabulary, which is exactly what rankRecords selects on.
`);

  console.log('  by position:');
  for (const [p, n] of [...byPosition.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`    ${p.padEnd(32)}${String(n).padStart(4)}`);
  }

  console.log('\n  volumes worth re-mining first (most offenders):');
  for (const [v, n] of [...byVolume.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)) {
    console.log(`    ${v.slice(0, 46).padEnd(48)}${String(n).padStart(4)}`);
  }

  if (process.argv.includes('--list')) {
    console.log('\n  every offender:');
    for (const o of offenders) {
      console.log(`    [${o.position}] ${o.prescription.slice(0, 96)}`);
    }
  }
  console.log('');
}

main();
