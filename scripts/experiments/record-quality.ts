#!/usr/bin/env node
/**
 * Score mined records against the transcript they came from.
 *
 *   scripts/experiments/record-quality.sh                        # score every mined volume
 *   scripts/experiments/record-quality.sh --records ~/flowlog-records-local
 *   scripts/experiments/record-quality.sh --compare ~/flowlog-records-local
 *
 * Costs nothing. Runs no model.
 *
 * This exists to answer "would a cheaper model do?" without a human reading a
 * thousand records. Every metric here is MECHANICAL — no judge, no second API
 * call — and each one encodes a claim the mining prompt already makes, so a
 * model that scores well is one that did the job as specified rather than one
 * that pleased a grader.
 *
 * The load-bearing metric is VERBATIM. `prompt.ts` demands the quote appear
 * word for word in the transcript and `records.ts` calls it "the only thing
 * that makes a record checkable in ten seconds" — but nothing in the pipeline
 * ever checked it. It is also the first thing a weaker model gives up: quoting
 * exactly from 25k tokens of context is a retrieval task, and a model that
 * cannot do it will paraphrase into something that reads perfectly and cites
 * nothing. That failure is invisible to every other gate.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { parseTranscript, type TranscriptLine } from '../mining/transcript.ts';
import { applyCorrections } from '../mining/prompt.ts';
import { isUnscopedAbsolute, type MinedRecord } from '../mining/records.ts';
import { volumeNumber } from '../mining/volumes.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const LIBRARY = join(homedir(), 'Documents', 'BJJ Instructionals');

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Mirrors mine-series.ts so a records file maps back to its transcript. */
function seriesName(dir: string): string {
  return basename(dir)
    .replace(/:.*$/, '')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index the library by the same `{slug}-v{n}` key the records files use. */
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
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.toLowerCase().endsWith('.txt')) continue;
      const head = readFileSync(p, 'utf8').slice(0, 4000);
      if (!/^\[\d+:\d{2}:\d{2}/m.test(head)) continue; // index file, not transcript
      const vol = volumeNumber(e.replace(/\.txt$/i, ''));
      if (vol === null) continue;
      out.set(`${slugify(seriesName(dir))}-v${vol}`, p);
    }
  };
  walk(root);
  return out;
}

/**
 * Normalisation for the verbatim check, in two tiers.
 *
 * `tight` collapses whitespace only — the model was told to copy characters,
 * and line joining is the one difference it cannot avoid, since the transcript
 * reaches it as one line per segment.
 *
 * `loose` also folds case and strips punctuation. The gap between the two is
 * the model tidying the instructor's grammar, which the prompt forbids but
 * which leaves the quote still findable and still checkable by a human.
 *
 * A quote that fails BOTH was not copied. It was written.
 */
const tight = (s: string) => s.replace(/\s+/g, ' ').trim();
const loose = (s: string) =>
  tight(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');

type QuoteVerdict = 'exact' | 'tidied' | 'spliced' | 'partial' | 'fabricated';

/**
 * How much of a quote is actually in the transcript, and in how many pieces.
 *
 * A plain substring test answers "did the model copy this?" but not the
 * question that matters when it says no. Two very different failures both come
 * back false:
 *
 *   SPLICED     every word is the instructor's, but taken from two moments and
 *               joined. The teaching point is real; the citation points at a
 *               sentence that was never said in one breath.
 *   FABRICATED  the model wrote a plausible sentence. The record is fiction
 *               wearing a citation, and no other gate in the pipeline notices.
 *
 * So walk the quote greedily: at each word take the longest run that survives
 * in the transcript, and count a run of 4+ words as copied. Coverage is the
 * share of words inside such runs, `segments` how many separate places they
 * came from. Spliced quotes come back near 1.0 coverage in 2-3 segments;
 * fabricated ones come back low.
 */
function matchProfile(
  quote: string,
  haystackLoose: string,
): { coverage: number; segments: number } {
  const words = loose(quote).split(' ').filter(Boolean);
  if (words.length === 0) return { coverage: 0, segments: 0 };
  const MIN_RUN = 4;
  let i = 0,
    covered = 0,
    segments = 0;
  while (i < words.length) {
    let best = 0;
    for (let n = Math.min(words.length - i, 60); n >= MIN_RUN; n--) {
      if (haystackLoose.includes(words.slice(i, i + n).join(' '))) {
        best = n;
        break;
      }
    }
    if (best >= MIN_RUN) {
      covered += best;
      segments++;
      i += best;
    } else i++;
  }
  return { coverage: covered / words.length, segments };
}

function classifyQuote(
  quote: string,
  haystackTight: string,
  haystackLoose: string,
): { verdict: QuoteVerdict; coverage: number; segments: number } {
  if (haystackTight.includes(tight(quote)))
    return { verdict: 'exact', coverage: 1, segments: 1 };
  if (haystackLoose.includes(loose(quote)))
    return { verdict: 'tidied', coverage: 1, segments: 1 };
  const { coverage, segments } = matchProfile(quote, haystackLoose);
  // 0.9 rather than 1.0: a spliced quote often drops or alters a word at the
  // seam, and calling that fabrication would bury the distinction this exists
  // to draw.
  if (coverage >= 0.9) return { verdict: 'spliced', coverage, segments };
  if (coverage >= 0.5) return { verdict: 'partial', coverage, segments };
  return { verdict: 'fabricated', coverage, segments };
}

/**
 * How far the cited timestamp sits from where the quote actually is.
 *
 * Provenance is the product promise — a record points a user at a moment in a
 * video they own. A record whose quote is real but whose timestamp is 200
 * seconds off still sends them to the wrong place, and no other gate notices.
 */
function timestampDrift(
  quote: string,
  lines: TranscriptLine[],
  cited: number,
): number | null {
  const needle = loose(quote).split(' ').slice(0, 6).join(' ');
  if (!needle) return null;
  let best: number | null = null;
  for (const l of lines) {
    if (loose(l.text).includes(needle)) {
      const d = Math.abs(l.startSeconds - cited);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

interface VolumeScore {
  slug: string;
  records: number;
  words: number;
  quotes: Record<QuoteVerdict, number>;
  spliceSegments: number[];
  driftOk: number; // within 30s of the quote
  driftMeasured: number;
  filled: Record<string, number>;
  unscoped: number;
  positions: Set<string>;
}

const FIELDS = ['why', 'detail', 'counter'] as const;

function scoreVolume(
  slug: string,
  records: MinedRecord[],
  transcriptPath: string,
): VolumeScore {
  const lines = parseTranscript(readFileSync(transcriptPath, 'utf8')).map(
    (l) => ({ ...l, text: applyCorrections(l.text) }),
  );
  const joined = lines.map((l) => l.text).join(' ');
  const haystackTight = tight(joined);
  const haystackLoose = loose(joined);

  const s: VolumeScore = {
    slug,
    records: records.length,
    words: joined.split(/\s+/).length,
    quotes: { exact: 0, tidied: 0, spliced: 0, partial: 0, fabricated: 0 },
    spliceSegments: [],
    driftOk: 0,
    driftMeasured: 0,
    filled: { why: 0, detail: 0, counter: 0, opponent: 0 },
    unscoped: 0,
    positions: new Set(),
  };

  for (const r of records) {
    s.positions.add(r.position);
    const { verdict, segments } = classifyQuote(
      r.quote,
      haystackTight,
      haystackLoose,
    );
    s.quotes[verdict]++;
    if (verdict === 'spliced') s.spliceSegments.push(segments);
    if (verdict !== 'fabricated') {
      const drift = timestampDrift(r.quote, lines, r.source.startSeconds);
      if (drift !== null) {
        s.driftMeasured++;
        if (drift <= 30) s.driftOk++;
      }
    }
    for (const f of FIELDS) if ((r[f] ?? '').trim()) s.filled[f]!++;
    if ((r.preconditions?.opponent ?? '').trim()) s.filled.opponent!++;
    if (isUnscopedAbsolute(r)) s.unscoped++;
  }
  return s;
}

interface Totals {
  label: string;
  volumes: number;
  records: number;
  words: number;
  quotes: Record<QuoteVerdict, number>;
  spliceSegments: number[];
  driftOk: number;
  driftMeasured: number;
  filled: Record<string, number>;
  unscoped: number;
  positions: Set<string>;
  perVolume: VolumeScore[];
}

function scoreDir(
  recordsDir: string,
  library: Map<string, string>,
  label: string,
): Totals {
  const t: Totals = {
    label,
    volumes: 0,
    records: 0,
    words: 0,
    quotes: { exact: 0, tidied: 0, spliced: 0, partial: 0, fabricated: 0 },
    spliceSegments: [],
    driftOk: 0,
    driftMeasured: 0,
    filled: { why: 0, detail: 0, counter: 0, opponent: 0 },
    unscoped: 0,
    positions: new Set(),
    perVolume: [],
  };
  const only = arg('--only');
  for (const f of readdirSync(recordsDir).sort()) {
    if (!f.endsWith('.records.json')) continue;
    const slug = f.replace(/\.records\.json$/, '');
    if (only && !slug.includes(only)) continue;
    const transcript = library.get(slug);
    if (!transcript) {
      console.error(`  skip ${slug} — no transcript found for this slug`);
      continue;
    }
    const raw = JSON.parse(readFileSync(join(recordsDir, f), 'utf8'));
    const records: MinedRecord[] = Array.isArray(raw)
      ? raw
      : (raw.records ?? []);
    const s = scoreVolume(slug, records, transcript);
    t.perVolume.push(s);
    t.volumes++;
    t.records += s.records;
    t.words += s.words;
    for (const k of Object.keys(t.quotes) as QuoteVerdict[])
      t.quotes[k] += s.quotes[k];
    t.spliceSegments.push(...s.spliceSegments);
    t.driftOk += s.driftOk;
    t.driftMeasured += s.driftMeasured;
    for (const k of Object.keys(t.filled)) t.filled[k]! += s.filled[k]!;
    t.unscoped += s.unscoped;
    for (const p of s.positions) t.positions.add(p);
  }
  return t;
}

const pct = (n: number, d: number) =>
  d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1)}%`;

function report(t: Totals) {
  const r = t.records;
  console.error(`\n${'='.repeat(64)}\n${t.label}\n${'='.repeat(64)}`);
  console.error(
    `volumes ${t.volumes}   records ${r}   positions ${t.positions.size}`,
  );
  console.error(
    `yield          ${((r / t.words) * 1000).toFixed(2)} records per 1000 transcript words`,
  );
  const q = t.quotes;
  console.error(`\nQUOTE FIDELITY  (the gate nothing else checks)`);
  const row = (k: QuoteVerdict, note: string) =>
    console.error(
      `  ${k.padEnd(11)}  ${String(q[k]).padStart(5)}  ${pct(q[k], r).padStart(6)}   ${note}`,
    );
  row('exact', 'copied character for character');
  row('tidied', 'found, but grammar or case altered');
  row('spliced', 'real words, joined from separate moments');
  row('partial', 'half traceable — quote drifts off the transcript');
  row('fabricated', 'NOT in the transcript. The record cites nothing.');
  if (t.spliceSegments.length) {
    const mean =
      t.spliceSegments.reduce((a, b) => a + b, 0) / t.spliceSegments.length;
    console.error(
      `    spliced quotes average ${mean.toFixed(1)} separate spans`,
    );
  }
  const trustworthy = q.exact + q.tidied;
  console.error(
    `  -> verifiable as one contiguous quote: ${pct(trustworthy, r)}`,
  );
  console.error(`\nPROVENANCE`);
  console.error(
    `  timestamp within 30s of the quote   ${pct(t.driftOk, t.driftMeasured)}  (of ${t.driftMeasured} locatable)`,
  );
  console.error(`\nFIELD FILL  (prompt calls these the under-filled ones)`);
  for (const k of ['why', 'detail', 'counter', 'opponent']) {
    console.error(`  ${k.padEnd(12)} ${pct(t.filled[k]!, r)}`);
  }
  console.error(
    `\nUNSCOPED ABSOLUTES  ${t.unscoped}  ${pct(t.unscoped, r)}  (lower is better)`,
  );
}

function compare(a: Totals, b: Totals) {
  const common = new Set(a.perVolume.map((v) => v.slug));
  const bv = b.perVolume.filter((v) => common.has(v.slug));
  console.error(
    `\n${'='.repeat(64)}\nHEAD TO HEAD — ${bv.length} volume(s) mined by both\n${'='.repeat(64)}`,
  );
  const av = a.perVolume.filter((v) => bv.some((x) => x.slug === v.slug));
  const sum = (vs: VolumeScore[], f: (v: VolumeScore) => number) =>
    vs.reduce((n, v) => n + f(v), 0);
  const rows: [string, string, string][] = [
    [
      'records',
      String(sum(av, (v) => v.records)),
      String(sum(bv, (v) => v.records)),
    ],
    [
      'exact quotes',
      pct(
        sum(av, (v) => v.quotes.exact),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.quotes.exact),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'contiguous',
      pct(
        sum(av, (v) => v.quotes.exact + v.quotes.tidied),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.quotes.exact + v.quotes.tidied),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'spliced',
      pct(
        sum(av, (v) => v.quotes.spliced),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.quotes.spliced),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'FABRICATED',
      pct(
        sum(av, (v) => v.quotes.fabricated),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.quotes.fabricated),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'timestamp <30s',
      pct(
        sum(av, (v) => v.driftOk),
        sum(av, (v) => v.driftMeasured),
      ),
      pct(
        sum(bv, (v) => v.driftOk),
        sum(bv, (v) => v.driftMeasured),
      ),
    ],
    [
      'why filled',
      pct(
        sum(av, (v) => v.filled.why!),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.filled.why!),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'counter filled',
      pct(
        sum(av, (v) => v.filled.counter!),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.filled.counter!),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'opponent filled',
      pct(
        sum(av, (v) => v.filled.opponent!),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.filled.opponent!),
        sum(bv, (v) => v.records),
      ),
    ],
    [
      'unscoped',
      pct(
        sum(av, (v) => v.unscoped),
        sum(av, (v) => v.records),
      ),
      pct(
        sum(bv, (v) => v.unscoped),
        sum(bv, (v) => v.records),
      ),
    ],
  ];
  console.error(
    `\n  ${'metric'.padEnd(18)}${a.label.slice(0, 20).padEnd(22)}${b.label.slice(0, 20)}`,
  );
  console.error(`  ${'-'.repeat(58)}`);
  for (const [k, x, y] of rows) {
    console.error(`  ${k.padEnd(18)}${x.padEnd(22)}${y}`);
  }
  console.error('');
}

function main() {
  if (!existsSync(LIBRARY)) {
    console.error(`error: library not found at ${LIBRARY}`);
    process.exit(1);
  }
  const library = indexLibrary(LIBRARY);
  console.error(`indexed ${library.size} transcripts`);

  const baseDir = arg('--records') ?? join(homedir(), 'flowlog-records');
  const base = scoreDir(
    resolve(baseDir),
    library,
    arg('--label') ?? basename(baseDir),
  );
  report(base);

  const other = arg('--compare');
  if (other) {
    const b = scoreDir(resolve(other), library, basename(resolve(other)));
    report(b);
    compare(base, b);
  }
}

main();
