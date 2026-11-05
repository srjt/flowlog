/**
 * Turning review records into serving records.
 *
 * Two stores, deliberately (see #37):
 *
 *   review store   full records — quote, source, chapter, timestamps.
 *                  Local only, gitignored, never uploaded.
 *   serving store  distilled mechanics with NO link to the source.
 *                  Supabase, read by the pipeline.
 *
 * The review store keeps the ten-second check that makes review affordable
 * ("does this card match its quote?"). The serving store is what the product
 * uses, and nothing in it should identify what it came from.
 *
 * Pure functions — no filesystem, no network — so the part that must not leak
 * is unit-testable.
 */

/** Fields that must never reach the serving store. */
const DROPPED_FIELDS = ['quote', 'source', 'chapter'] as const;

/**
 * Person names to remove from the derived text.
 *
 * Instructors demonstrate on a training partner and name them constantly; an
 * audit of 953 records found a partner named in 6 of them. A name is never
 * mechanically necessary — "his elbow" reads better than "Mateus's elbow"
 * anyway — so removing them costs nothing and closes an obvious tell.
 *
 * Extend as new sources are mined.
 */
export const SCRUBBED_NAMES = [
  // Order matters: longer variants first, or `\bMateus\b` claims the stem and
  // leaves the suffix behind. "Mateusz" survived a publish this way — the
  // automated guard passed and the manual sweep in flowlog-publish caught it,
  // which is the whole reason that sweep is a separate step.
  'Mateusz',
  'Mateus',
  'Matace', // recurring mis-transcription of the same name
  'Brian', // training partner in the Ageless series; not in any title
  'Danaher',
  'Gordon',
  'Garry',
  'Tonon',
  'Placido',
];

/**
 * Markers that betray the source. The publish step REFUSES to run if any
 * survives, so a future mined series cannot quietly reintroduce a citation.
 */
/**
 * Self-references the instructor makes to the recording itself.
 *
 * Neutralised rather than rejected, exactly like a partner's name: "the
 * instructional is designed for people who are physically disadvantaged" is
 * real coaching context wearing a citation, and dropping the record would
 * throw the coaching away to remove three words.
 *
 * Found by the guard refusing a publish. Two of the three offenders said
 * "throughout this video", which `SOURCE_MARKERS` did not cover even though
 * the flowlog-publish checklist tells a human to grep for it — so they would
 * have shipped silently. Both the scrub and the marker list are extended here.
 */
export const SOURCE_PHRASES: [RegExp, string][] = [
  [
    /\bthis (?:instructional|video|series|lesson plan|course)\b/gi,
    'this approach',
  ],
  [
    /\bthe (?:instructional|video|series|lesson plan|course)\b/gi,
    'this approach',
  ],
  [/\bthroughout this approach\b/gi, 'throughout'],
  [/\bin this approach\b/gi, 'here'],
];

export const SOURCE_MARKERS: RegExp[] = [
  /\bthis video\b/i,
  /\bthis series\b/i,
  /\blesson plan\b/i,
  /\bgff\b/i,
  /go further faster/i,
  /\bvol(?:ume)?\s*\.?\s*\d/i,
  // A source timestamp, which is a citation in disguise. Deliberately requires
  // THREE components: mined provenance is always H:MM:SS, whereas grapplers
  // describe angles in clock directions — "push in that 10:30 direction" is
  // mechanics, not a reference, and blocking it would reject real content.
  /\b\d{1,2}:\d{2}:\d{2}\b/,
  /\binstructional\b/i,
  ...SCRUBBED_NAMES.map((n) => new RegExp(`\\b${n}\\b`, 'i')),
];

export interface ServingRecord {
  id: string;
  sportKey: string;
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  certified: boolean;
  contested: boolean;
}

/**
 * Remove person names from derived text.
 *
 * Replaces with a neutral pronoun rather than deleting, so the sentence still
 * reads: "Mateus sits through" -> "they sits through" would be worse than
 * "your opponent sits through".
 */
export function scrubNames(text: string): string {
  let out = text;
  // Source self-references first: they are phrases, and scrubbing a name
  // inside one would leave a stranger sentence than scrubbing the phrase.
  for (const [re, to] of SOURCE_PHRASES) out = out.replace(re, to);
  for (const name of SCRUBBED_NAMES) {
    out = out.replace(new RegExp(`\\b${name}'s\\b`, 'gi'), "your opponent's");
    out = out.replace(new RegExp(`\\b${name}\\b`, 'gi'), 'your opponent');
  }
  // Collapse any doubling the substitution introduced.
  return out
    .replace(/your opponent's your opponent/gi, "your opponent's")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Build the serving record. `id` is supplied by the caller from the mapping —
 * it must be opaque and must NOT be derived from the review record, because a
 * derived id is itself a citation.
 */
export function toServingRecord(
  review: Record<string, unknown>,
  id: string,
  sportKey = 'bjj',
): ServingRecord {
  const pre = (review.preconditions ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => scrubNames(typeof v === 'string' ? v : '');
  return {
    id,
    sportKey,
    position: String(review.position ?? ''),
    prescription: s(review.prescription),
    why: s(review.why),
    detail: s(review.detail),
    counter: s(review.counter),
    gi: String(pre.gi ?? 'either'),
    level: String(pre.level ?? 'any'),
    opponent: s(pre.opponent),
    // Review state is carried, never reset — certification is the expensive
    // artifact and must survive a re-publish.
    certified: review.certified === true,
    contested: review.contested === true,
  };
}

export interface LeakFinding {
  id: string;
  field: string;
  marker: string;
  excerpt: string;
}

/**
 * Scan serving records for anything that points back to the source.
 *
 * This is the backstop the whole boundary rests on. It runs on the OUTPUT, so
 * it catches leaks regardless of which field or which future series introduced
 * them — including the ones an author did not think to strip.
 */
export function findLeaks(records: ServingRecord[]): LeakFinding[] {
  const out: LeakFinding[] = [];
  const fields = [
    'prescription',
    'why',
    'detail',
    'counter',
    'opponent',
    'id',
  ] as const;
  for (const r of records) {
    for (const field of fields) {
      const value = String(r[field] ?? '');
      for (const marker of SOURCE_MARKERS) {
        const m = marker.exec(value);
        if (m) {
          out.push({
            id: r.id,
            field,
            marker: String(marker),
            excerpt: value.slice(Math.max(0, m.index - 30), m.index + 40),
          });
        }
      }
    }
    for (const dropped of DROPPED_FIELDS) {
      if (dropped in (r as object)) {
        out.push({
          id: r.id,
          field: dropped,
          marker: 'field must not be present',
          excerpt: '',
        });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation with the live serving store (#131)
//
// The leak check above protects the source. This protects the corpus: it asks
// whether the review store being published plausibly IS the store the live
// serving table was published from, or only a fragment of it.
//
// It exists because the default once pointed at a stale store. Publishing it
// would have upserted 1,874 records over a 5,574-record live store, printed a
// healthy summary, and quietly merged two different mining runs into one
// serving table. The review-store count and the mapping reuse count both look
// fine in that case; the number that does not is how much of the LIVE store
// the publish accounts for, and nothing computed it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The share of the live store a publish must account for before it runs
 * without a declared reason.
 *
 * Why 0.9: a full re-publish of the canonical store carries every live id, so
 * it sits at or above 1.0. The case this exists for (the stale store) sits at
 * 1,637 carried ids over 5,574 live, about 0.29. Any value between those
 * separates them; 0.9 is set high because the costs are lopsided. A false
 * refusal costs one `--partial-publish "<reason>"`. A false permit silently
 * merges corpora, and unpicking that after reviewers have voted costs their
 * donated attention. The 10% of headroom is for live rows the store no longer
 * carries: publish never deletes, so a forced re-mine of a few volumes leaves
 * their old rows live. Past 10%, that drift is itself worth stopping for.
 *
 * Deliberately not a flag. A tunable threshold is a second, quieter override.
 */
export const LIVE_COVERAGE_THRESHOLD = 0.9;

export interface ReconcileInput {
  /** Every serving id this publish would write. */
  servingIds: readonly string[];
  /**
   * The ids this run minted fresh. A new random uuid cannot already be live,
   * so these never count toward coverage. That is also what makes a lost or
   * wrong id mapping refuse instead of re-minting every voted record: with no
   * mapping every id is fresh, and coverage is zero.
   */
  mintedIds?: Iterable<string>;
  /** Records currently in the serving store, counted by the caller. */
  liveCount: number;
  threshold?: number;
  /** The `--partial-publish` reason, if the operator declared one. */
  partialPublishReason?: string | null;
}

export interface ReconcileDecision {
  permit: boolean;
  basis:
    | 'first-publish'
    | 'covers-live'
    | 'partial-publish-declared'
    | 'refused';
  /** Distinct ids this publish writes. */
  writes: number;
  /** Of those, the ids that already existed: the only ones that can be live. */
  carried: number;
  liveCount: number;
  /** carried / liveCount; null when the live store is empty. */
  coverage: number | null;
  threshold: number;
  partialPublishReason: string | null;
}

/**
 * Decide whether a publish plausibly accounts for the live store.
 *
 * Pure: the live count comes in as a number, so the decision is testable with
 * no database. Refuses rather than warns. A warning in a long pre-flight is a
 * line nobody reads, and the failure it prevents is silent.
 */
export function reconcileWithLive(input: ReconcileInput): ReconcileDecision {
  const threshold = input.threshold ?? LIVE_COVERAGE_THRESHOLD;
  const { liveCount } = input;
  if (!Number.isInteger(liveCount) || liveCount < 0) {
    throw new Error(`live record count must be a whole number: ${liveCount}`);
  }
  const reason = input.partialPublishReason?.trim() || null;
  const ids = new Set(input.servingIds);
  const minted = new Set(input.mintedIds ?? []);
  let carried = 0;
  for (const id of ids) if (!minted.has(id)) carried++;

  const base = {
    writes: ids.size,
    carried,
    liveCount,
    threshold,
    partialPublishReason: reason,
  };
  // First publish: nothing live to merge over.
  if (liveCount === 0) {
    return { ...base, permit: true, basis: 'first-publish', coverage: null };
  }
  const coverage = carried / liveCount;
  if (coverage >= threshold) {
    return { ...base, permit: true, basis: 'covers-live', coverage };
  }
  if (reason) {
    return {
      ...base,
      permit: true,
      basis: 'partial-publish-declared',
      coverage,
    };
  }
  return { ...base, permit: false, basis: 'refused', coverage };
}

export interface MappingDrift {
  /**
   * none         no mapping yet: a first publish from this store
   * in-step      every record in the store already has a serving id
   * unpublished  some records have none yet: fresh mining, normal
   * disjoint     the mapping shares no id with the store. It belongs to a
   *              different store, and every id would be minted fresh.
   */
  kind: 'none' | 'in-step' | 'unpublished' | 'disjoint';
  /** Entries in the mapping. */
  mapped: number;
  /** Distinct review ids in the store. */
  review: number;
  /** Review ids the mapping already knows. */
  overlap: number;
  /** Review ids it does not: records not yet published. */
  unmapped: number;
  /** Mapping entries with no record in the store (re-mined or removed). */
  orphaned: number;
  /** Only `disjoint` is worth a warning, and it never refuses on its own. */
  warn: boolean;
}

/**
 * How the id mapping relates to the store it sits beside.
 *
 * A mapping SMALLER than its store is the normal state right after mining:
 * those records have not been published yet, and flagging that would teach
 * the operator to ignore the line. A mapping that does not overlap the store
 * at all is a different condition: it was made for other records.
 */
export function classifyMappingDrift(
  mappingIds: Iterable<string>,
  reviewIds: Iterable<string>,
): MappingDrift {
  const mapped = new Set(mappingIds);
  const review = new Set(reviewIds);
  let overlap = 0;
  for (const id of review) if (mapped.has(id)) overlap++;
  const counts = {
    mapped: mapped.size,
    review: review.size,
    overlap,
    unmapped: review.size - overlap,
    orphaned: mapped.size - overlap,
  };
  if (mapped.size === 0) return { ...counts, kind: 'none', warn: false };
  if (overlap === 0) return { ...counts, kind: 'disjoint', warn: true };
  if (counts.unmapped === 0) return { ...counts, kind: 'in-step', warn: false };
  return { ...counts, kind: 'unpublished', warn: false };
}

export interface PreflightInput {
  serving: ServingRecord[];
  mintedIds?: Iterable<string>;
  liveCount: number;
  threshold?: number;
  partialPublishReason?: string | null;
}

export interface PreflightResult {
  reconciliation: ReconcileDecision;
  leaks: LeakFinding[];
  /** Publish may proceed only when BOTH checks pass. */
  ok: boolean;
}

/**
 * The whole publish gate: the store guard and the leak check, side by side.
 *
 * The leak check is a function of the records alone and takes nothing from
 * the override. `--partial-publish` permits a fragment of the corpus, never a
 * record that cites its source.
 */
export function preflight(input: PreflightInput): PreflightResult {
  const reconciliation = reconcileWithLive({
    servingIds: input.serving.map((r) => r.id),
    mintedIds: input.mintedIds,
    liveCount: input.liveCount,
    threshold: input.threshold,
    partialPublishReason: input.partialPublishReason,
  });
  const leaks = findLeaks(input.serving);
  return {
    reconciliation,
    leaks,
    ok: reconciliation.permit && leaks.length === 0,
  };
}

/**
 * Read the total out of a PostgREST `Content-Range` header (`0-0/5574`, or
 * `*` then `/0` for an empty table). Null when there is no total to read; the
 * caller must then refuse, because a guard that cannot count the live store
 * has not run.
 */
export function parseContentRangeTotal(header: string | null): number | null {
  const m = /\/(\d+)\s*$/.exec(header ?? '');
  return m ? Number(m[1]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permit a publish that does not account for the live store. It takes a
 * reason, because bypassing the guard should be a decision and not a reflex,
 * and the reason is printed so the decision is on the record.
 *
 * It is NOT a leak-check bypass. There is no leak-check bypass.
 */
export const PARTIAL_PUBLISH_FLAG = '--partial-publish';

/** Flags that take a value, and flags that do not. Nothing else is accepted. */
const VALUE_FLAGS: readonly string[] = [
  '--records',
  '--mapping',
  '--sql',
  PARTIAL_PUBLISH_FLAG,
];
const BOOLEAN_FLAGS: readonly string[] = ['--dry-run', '--which-store'];

export interface PublishOptions {
  records: string | null;
  mapping: string | null;
  sql: string | null;
  dryRun: boolean;
  /** Print the canonical store and exit. */
  whichStore: boolean;
  partialPublishReason: string | null;
}

/**
 * Parse the publish command line. Throws on anything it does not recognise.
 *
 * Strict on purpose: an unknown flag used to be ignored, so a mistyped
 * `--dryrun` turned a rehearsal into a real upload.
 */
export function parsePublishArgs(argv: readonly string[]): PublishOptions {
  const out: PublishOptions = {
    records: null,
    mapping: null,
    sql: null,
    dryRun: false,
    whichStore: false,
    partialPublishReason: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (BOOLEAN_FLAGS.includes(a)) {
      if (a === '--dry-run') out.dryRun = true;
      if (a === '--which-store') out.whichStore = true;
      continue;
    }
    if (VALUE_FLAGS.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--') || v.trim() === '') {
        throw new Error(
          a === PARTIAL_PUBLISH_FLAG
            ? `${a} needs a reason: ${a} "<why this publish is partial>"`
            : `${a} needs a value`,
        );
      }
      if (a === '--records') out.records = v;
      if (a === '--mapping') out.mapping = v;
      if (a === '--sql') out.sql = v;
      if (a === PARTIAL_PUBLISH_FLAG) out.partialPublishReason = v.trim();
      continue;
    }
    throw new Error(
      `unrecognised argument: ${a}\n  accepted: ${[...BOOLEAN_FLAGS, ...VALUE_FLAGS].join(' ')}`,
    );
  }
  return out;
}
