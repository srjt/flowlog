#!/usr/bin/env node
/**
 * Mine every volume of one or more instructional series.
 *
 *   scripts/mining/mine-series.sh "<dir>" [more dirs...] --instructor "John Danaher"
 *   scripts/mining/mine-series.sh ~/Documents/"BJJ Instructionals"/"John Danaher"/GFF*
 *
 * Runs `mine.ts` once per volume, sequentially. Volumes already mined are
 * SKIPPED — re-mining is not merely wasteful, it churns record ids and would
 * orphan any certification already done. `--force` overrides.
 *
 * Each volume runs in its own process so one bad volume cannot take down the
 * series; failures are collected and reported at the end.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { volumeNumber } from './volumes.ts';

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}
function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string) => process.argv.includes(flag);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Human name for a series, from its directory.
 * "GFF - Pin Escapes & Turtle Escapes: BJJ Fundamentals" -> "GFF Pin Escapes & Turtle Escapes"
 */
function seriesName(dir: string): string {
  return basename(dir)
    .replace(/:.*$/, '')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Volume {
  path: string;
  volume: number;
}

/** Transcripts carry `[h:mm:ss -> ...]` lines; chapter indexes do not. */
function looksLikeTranscript(path: string): boolean {
  return /^\[\d+:\d{2}:\d{2}/m.test(readFileSync(path, 'utf8').slice(0, 4000));
}

/**
 * Volumes in a series directory, in order.
 *
 * Anything that reads as a transcript but yields no volume number is REPORTED,
 * not skipped in silence. That silence is what turned a naming quirk into an
 * invisible hole in the corpus: a volume that never appears is indistinguishable
 * from one already mined.
 */
function findVolumes(dir: string): Volume[] {
  const out: Volume[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt') || entry.startsWith('._'))
      continue;
    const path = join(dir, entry);
    const volume = volumeNumber(entry.replace(/\.txt$/i, ''));
    if (volume === null) {
      // Index files carry no timestamps and are correctly excluded in silence.
      if (looksLikeTranscript(path)) {
        console.error(
          `  ⚠️  no volume number in "${entry}" — SKIPPED, though it reads as a transcript`,
        );
      }
      continue;
    }
    if (!looksLikeTranscript(path)) continue;
    out.push({ path, volume });
  }
  return out.sort((a, b) => a.volume - b.volume);
}

function main() {
  // Positional args only. Flags that TAKE a value consume the next argv entry,
  // otherwise `--instructor "John Danaher"` is read as a directory to mine.
  const VALUE_FLAGS = new Set(['--instructor', '--out', '--model']);
  const positional: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (VALUE_FLAGS.has(a)) {
      i++; // skip its value
      continue;
    }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }

  const dirs = positional
    .filter((a, i, all) => all.indexOf(a) === i)
    .map((d) => resolve(d))
    .filter((d) => {
      if (!existsSync(d) || !statSync(d).isDirectory()) {
        console.error(`skipping (not a directory): ${d}`);
        return false;
      }
      return true;
    });
  if (dirs.length === 0) {
    die(
      'usage: mine-series.sh <series-dir> [more dirs...] --instructor "Name"',
    );
  }

  const instructor = arg('--instructor') ?? 'Unknown';
  const outDir = arg('--out') ?? join(homedir(), 'flowlog-records');
  const force = has('--force');
  const dryRun = has('--dry-run');
  const mine = join(dirname(new URL(import.meta.url).pathname), 'mine.ts');

  const planned: { dir: string; series: string; vol: Volume }[] = [];
  let skipped = 0;
  // Reconciled per series, so a directory that yields nothing is visible
  // instead of being absorbed into an aggregate that reads as success (#75).
  const perSeries: { series: string; found: number; queued: number }[] = [];
  for (const dir of dirs) {
    const series = seriesName(dir);
    const found = findVolumes(dir);
    const before = planned.length;
    for (const vol of found) {
      const outFile = join(
        outDir,
        `${slugify(series)}-v${vol.volume}.records.json`,
      );
      if (existsSync(outFile) && !force) {
        skipped++;
        continue;
      }
      planned.push({ dir, series, vol });
    }
    perSeries.push({
      series,
      found: found.length,
      queued: planned.length - before,
    });
  }

  console.error(
    `\n${planned.length} volume(s) to mine across ${dirs.length} series` +
      (skipped ? `, ${skipped} already mined (skipped)` : '') +
      (force ? '  [--force: re-mining]' : ''),
  );
  for (const r of perSeries) {
    const note =
      r.found === 0
        ? '  ⚠️  NO VOLUMES FOUND — check the filenames'
        : r.queued === 0
          ? '  (all already mined)'
          : '';
    console.error(
      `   ${r.series}: ${r.found} volume(s) found, ${r.queued} queued${note}`,
    );
  }
  for (const p of planned) {
    console.error(`   ${p.series} vol ${p.vol.volume}`);
  }
  if (planned.length === 0) {
    console.error('\nNothing to do.\n');
    return;
  }
  if (dryRun && !has('--dry-run-mine')) {
    console.error('\n--dry-run: listing only, no volumes mined.\n');
    return;
  }

  const failures: string[] = [];
  planned.forEach((p, i) => {
    const label = `${p.series} vol ${p.vol.volume}`;
    console.error(`\n${'='.repeat(70)}\n[${i + 1}/${planned.length}] ${label}`);
    const res = spawnSync(
      process.execPath,
      [
        '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON',
        mine,
        p.vol.path,
        '--instructor',
        instructor,
        '--instructional',
        p.series,
        '--volume',
        String(p.vol.volume),
        '--out',
        outDir,
        ...process.argv
          .filter((a) => a === '--model')
          .flatMap(() => ['--model', arg('--model')!]),
      ],
      { stdio: 'inherit' },
    );
    if (res.status !== 0) failures.push(label);
  });

  console.error(`\n${'='.repeat(70)}`);
  console.error(
    `DONE  ${planned.length - failures.length}/${planned.length} volumes mined`,
  );
  if (failures.length) {
    console.error('FAILED:');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nRe-run the same command — mined volumes are skipped, so only',
    );
    console.error('the failures are retried.');
    process.exitCode = 1;
  }
  console.error('');
}

main();
