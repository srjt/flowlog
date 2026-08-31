#!/usr/bin/env node
/**
 * The work list for `remine-local.sh`: every volume Gemini has already mined
 * whose transcript is still on disk, as `slug<TAB>path<TAB>series<TAB>volume<TAB>instructor`.
 *
 * Sorted SHORTEST FIRST. A run of this length will be interrupted — by the
 * throughput decay, by the machine sleeping, by the user — so the order should
 * maximise volumes completed rather than words processed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

import { volumeNumbersForDirectory } from '../mining/volumes.ts';

const H = homedir();
const LIB = join(H, 'Documents', 'BJJ Instructionals');
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

const mined = new Set(
  readdirSync(join(H, 'flowlog-records'))
    .filter((f) => f.endsWith('.records.json'))
    .map((f) => f.replace('.records.json', '')),
);

const rows: { line: string; size: number }[] = [];
const seen = new Set<string>();

(function walk(dir: string) {
  const entries = readdirSync(dir).filter((e) => !e.startsWith('.'));
  for (const e of entries) {
    if (statSync(join(dir, e)).isDirectory()) walk(join(dir, e));
  }
  // Transcripts of THIS directory, numbered together — a repeated `vol` marker
  // names the series, and numbering one filename at a time collapses them.
  const txts = entries.filter(
    (e) => e.toLowerCase().endsWith('.txt') && !/^contents?\.txt$/i.test(e),
  );
  const numbers = volumeNumbersForDirectory(
    txts.map((e) => e.replace(/\.txt$/i, '')),
  );
  for (const e of txts) {
    const p = join(dir, e);
    if (!/^\[\d+:\d{2}:\d{2}/m.test(readFileSync(p, 'utf8').slice(0, 4000)))
      continue;
    const v = numbers.get(e.replace(/\.txt$/i, '')) ?? null;
    if (v === null) continue;
    const slug = `${slugify(seriesName(dir))}-v${v}`;
    if (!mined.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const instructor = p.includes('/Gordon Ryan/')
      ? 'Gordon Ryan'
      : 'John Danaher';
    rows.push({
      line: [slug, p, seriesName(dir), String(v), instructor].join('\t'),
      size: statSync(p).size,
    });
  }
})(LIB);

rows.sort((a, b) => a.size - b.size);
process.stdout.write(rows.map((r) => r.line).join('\n') + '\n');
