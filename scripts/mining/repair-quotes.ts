#!/usr/bin/env node
/**
 * Trim spliced quotes in an already-mined record store to a verbatim span.
 *
 *   scripts/mining/repair-quotes.sh                    # dry run, reports only
 *   scripts/mining/repair-quotes.sh --write            # rewrite the records
 *   scripts/mining/repair-quotes.sh --records <dir> --write
 *
 * Costs nothing. Runs no model.
 *
 * A spliced quote is two things the instructor said minutes apart, joined into
 * one sentence. Every word is genuine and the sentence was never spoken, so a
 * reviewer searching the transcript does not find it — the ten-second check
 * that makes review affordable silently fails, and a splice is indistinguishable
 * from an invention at that point.
 *
 * 14.2% of the mined corpus is spliced, and `repairQuote` fixes 100% of them by
 * narrowing to the longest run the transcript actually contains. It is a
 * NARROWING, never a rewrite: the result is always a substring of real
 * transcript text, so this cannot introduce anything the instructor did not say.
 *
 * Dry-run by default, because it rewrites the review store in place and that
 * store is the only copy of the verbatim text. `--write` takes a `.bak` of
 * every file it touches first.
 */

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

import { parseTranscript } from './transcript.ts';
import { applyCorrections } from './prompt.ts';
import { repairQuote, type MinedRecord } from './records.ts';
import { volumeNumbersForDirectory } from './volumes.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (f: string) => process.argv.includes(f);

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

/** Slug -> transcript, numbered per directory so a series label cannot collapse it. */
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

function main() {
  const recordsDir = arg('--records') ?? join(homedir(), 'flowlog-records');
  const write = has('--write');
  const library = indexLibrary(
    join(homedir(), 'Documents', 'BJJ Instructionals'),
  );

  if (!existsSync(recordsDir)) {
    console.error(`error: no such directory ${recordsDir}`);
    process.exit(1);
  }
  console.error(`\n${write ? 'REPAIRING' : 'DRY RUN'}  ${recordsDir}`);
  console.error(`indexed ${library.size} transcripts\n`);

  let files = 0,
    records = 0,
    repaired = 0,
    dropped = 0,
    skipped = 0,
    wordsDropped = 0;
  const examples: string[] = [];

  for (const f of readdirSync(recordsDir).sort()) {
    if (!f.endsWith('.records.json')) continue;
    const slug = f.replace(/\.records\.json$/, '');
    const transcript = library.get(slug);
    if (!transcript) {
      console.error(`  skip ${slug} — no transcript maps to this slug`);
      skipped++;
      continue;
    }
    const text = parseTranscript(readFileSync(transcript, 'utf8'))
      .map((l) => applyCorrections(l.text))
      .join(' ');

    const recs: MinedRecord[] = JSON.parse(
      readFileSync(join(recordsDir, f), 'utf8'),
    );
    let changed = 0;
    const out: MinedRecord[] = [];
    for (const r of recs) {
      records++;
      const fix = repairQuote(r.quote, text, `${r.prescription} ${r.detail}`);
      if (fix.unverifiable) {
        // Loud, and NOT silently discarded: this store is the only copy of the
        // verbatim text, so a record whose quote cannot be located is reported
        // for a human rather than deleted by a maintenance script.
        console.error(
          `  UNVERIFIABLE ${slug} ${r.id}: "${r.quote.slice(0, 70)}"`,
        );
        dropped++;
        out.push(r);
        continue;
      }
      if (fix.repaired) {
        repaired++;
        changed++;
        wordsDropped += fix.dropped;
        if (examples.length < 3) {
          examples.push(
            `  ${slug} ${r.id}\n    was: "${r.quote.slice(0, 90)}"\n    now: "${fix.quote.slice(0, 90)}"`,
          );
        }
        out.push({ ...r, quote: fix.quote, quoteRepaired: true });
      } else {
        out.push(r);
      }
    }
    files++;
    if (changed && write) {
      copyFileSync(join(recordsDir, f), join(recordsDir, f + '.bak'));
      writeFileSync(
        join(recordsDir, f),
        JSON.stringify(out, null, 2) + '\n',
        'utf8',
      );
    }
  }

  console.error(`\nfiles ${files}   records ${records}`);
  console.error(
    `spliced quotes trimmed to a verbatim span: ${repaired} (${((repaired / records) * 100).toFixed(1)}%)`,
  );
  console.error(`spliced words dropped: ${wordsDropped}`);
  if (dropped)
    console.error(`UNVERIFIABLE (left untouched, listed above): ${dropped}`);
  if (skipped) console.error(`files skipped (no transcript): ${skipped}`);
  if (examples.length) {
    console.error(`\nexamples:`);
    for (const e of examples) console.error(e);
  }
  console.error(
    write
      ? `\nWritten. Originals kept as *.records.json.bak\n`
      : `\nDry run — nothing written. Re-run with --write to apply.\n`,
  );
}

main();
