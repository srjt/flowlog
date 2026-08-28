/**
 * Mined instructional records — the schema, its gates, and validation.
 *
 * A record is one teaching point pulled out of an instructional: roughly 60
 * words distilled from 90 seconds of speech. The whole map is built on these.
 *
 * Pure — no filesystem, no network — so validation and id assignment are
 * testable without a corpus or an API key.
 */

import { positionById } from '../../src/sports/bjj/bjjPositions.ts';

/** Conditions under which a record's prescription actually holds. */
export interface Preconditions {
  /** 'gi' | 'no-gi' | 'either' — several escapes are grip-dependent. */
  gi: 'gi' | 'no-gi' | 'either';
  /** Rough level the advice suits, or 'any'. */
  level: 'beginner' | 'intermediate' | 'advanced' | 'any';
  /** What the opponent is doing for this to apply. Free text, may be empty. */
  opponent: string;
}

export interface MinedRecord {
  /** Stable id. See `assignIds` for what "stable" does and does not promise. */
  id: string;
  /** Canonical position id from the BJJ taxonomy. */
  position: string;
  /**
   * What the instructor tells you to do, or not do.
   *
   * There is deliberately NO separate `mistake` field: instructors name
   * mistakes as prohibitions ("never bridge straight up"), so the mistake is
   * already the negative half of this. A separate field would be the model
   * restating itself with no quote able to back it — one weakly-sourced field
   * would undermine the ten-second check the review budget depends on.
   */
  prescription: string;
  /**
   * Why it works, or why the alternative fails.
   *
   * Load-bearing. `detail` buys specificity; `why` buys the depth that the
   * whole effort exists to add. If a field gets cut for being awkward to
   * extract, not this one.
   */
  why: string;
  /** The concrete mechanical specific — a grip, an angle, a weight shift. */
  detail: string;
  /** What the opponent does to defeat it, when the instructor says. */
  counter: string;
  preconditions: Preconditions;
  /** Chapter title, when the title ships an index. */
  chapter: string | null;
  source: {
    instructor: string;
    instructional: string;
    volume: number;
    /** `H:MM:SS` into the volume. */
    timestamp: string;
    startSeconds: number;
  };
  /**
   * Verbatim instructional text backing the prescription.
   *
   * This is what makes a record checkable in ten seconds without knowing any
   * jiu-jitsu — does the record match the quote? It is third-party text and
   * MUST NOT ship to users; only the derived mechanic does.
   */
  quote: string;
  /**
   * Hard gate. An uncertified record may not ground a user-facing cue.
   * Defaults false and is only ever set by human review.
   */
  certified: boolean;
  /**
   * Set when another record for the same position contradicts this one after
   * preconditions are taken into account. A contested position cannot ground a
   * cue until a human has looked.
   */
  contested: boolean;
}

/** A record as the model returns it, before validation. */
export interface RawRecord {
  position?: unknown;
  prescription?: unknown;
  why?: unknown;
  detail?: unknown;
  counter?: unknown;
  preconditions?: unknown;
  quote?: unknown;
  startSeconds?: unknown;
}

export interface ValidationIssue {
  index: number;
  reason: string;
  /** What the model actually returned, for the report. */
  offending: unknown;
}

export interface ValidationResult {
  valid: MinedRecord[];
  rejected: ValidationIssue[];
  /**
   * Kept, but flagged. A warning is for a record that teaches something real
   * and is unsafe to combine with others — rejecting it would throw away
   * coaching, so it ships and gets reported (issue #102).
   */
  warnings: ValidationIssue[];
}

/**
 * Words that make a prescription unconditional.
 *
 * An absolute does not degrade gracefully. A hedged record with no
 * precondition gets weighed against its neighbours; "never play with an
 * underhook while maintaining a knee shield" is either honoured or
 * contradicted. When two absolutes disagree and neither carries a scope, the
 * cue inherits whichever the model happened to weight.
 *
 * This is not hypothetical. Two records for `knee-shield-half-guard-bottom`,
 * from the same instructor, both unscoped:
 *
 *   "Do NOT worry about connecting your knee and elbow when playing a LOW
 *    knee shield."
 *   "ALWAYS keep your knee and elbow connected when playing a HIGH knee
 *    shield."
 *
 * Both correct as taught. Together, with nothing to separate them, a coin flip.
 */
const ABSOLUTE = /\b(always|never|do not|don't|must|avoid|no need to)\b/i;

/**
 * "do not" is not always an instruction.
 *
 * "movements that ... do not REQUIRE you to invert" is describing a property,
 * not telling anyone to do anything. Counting it produced a false collision
 * between two records that agree perfectly ("build a straight-spine game" and
 * "do not bridge"), which is worse than missing one: a metric that cries wolf
 * gets ignored.
 */
const DESCRIPTIVE =
  /\b(do not|don't|must)\s+(require|need|have to|want|involve|mean|imply)\b/i;

/**
 * Does this prescription state an absolute without saying when it applies?
 *
 * Deliberately NOT a rejection and deliberately not auto-repaired. The scope is
 * often present in the prose ("when playing a low knee shield"), but lifting it
 * with a regex produced mangled fragments — "When using a crab ride with two
 * legs under your opponent's legs, you must have a" — and a truncated clause in
 * a field the prompt tells the model to honour is worse than an empty one.
 */
export function isUnscopedAbsolute(record: {
  prescription: string;
  preconditions: { opponent: string };
}): boolean {
  if (record.preconditions.opponent.trim() !== '') return false;
  if (!ABSOLUTE.test(record.prescription)) return false;
  // A descriptive "do not require" is the only match: nothing is being
  // instructed, so there is nothing to contradict.
  const stripped = record.prescription.replace(DESCRIPTIVE, ' ');
  return ABSOLUTE.test(stripped);
}

const GI_VALUES = new Set(['gi', 'no-gi', 'either']);
const LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'any']);

/**
 * Synonyms the model reasonably reaches for. Normalised rather than rejected.
 *
 * The distinction that matters: reject what is WRONG, normalise what is merely
 * PHRASED differently. A position outside the taxonomy is dangerous and must be
 * rejected — every later lookup would be confidently wrong. `gi: "any"` is not
 * dangerous, it is the same meaning as "either" in the vocabulary the model
 * already uses for `level`. Rejecting it cost an entire volume: 23 of that
 * volume's 24 records were thrown away over this one word.
 */
const GI_SYNONYMS: Record<string, string> = {
  any: 'either',
  both: 'either',
  'n/a': 'either',
  none: 'either',
  nogi: 'no-gi',
  'no gi': 'no-gi',
  no_gi: 'no-gi',
  gi_only: 'gi',
  'gi only': 'gi',
};

const LEVEL_SYNONYMS: Record<string, string> = {
  all: 'any',
  either: 'any',
  novice: 'beginner',
  white: 'beginner',
  fundamental: 'beginner',
  fundamentals: 'beginner',
  expert: 'advanced',
  'high level': 'advanced',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate model output against the schema.
 *
 * Rejects loudly rather than dropping silently: every rejection is returned
 * with the offending value so the run can report what the model got wrong. A
 * miner that quietly discards a third of its output looks like it worked.
 */
export function validateRecords(
  raw: RawRecord[],
  source: Omit<MinedRecord['source'], 'timestamp' | 'startSeconds'>,
  chapterFor: (seconds: number) => string | null,
): ValidationResult {
  const valid: MinedRecord[] = [];
  const rejected: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  raw.forEach((r, index) => {
    const reject = (reason: string, offending: unknown) =>
      rejected.push({ index, reason, offending });

    const position = str(r.position);
    // Closed vocabulary: the position must be one the taxonomy actually
    // defines. Anything else is a guess, and a wrong position makes every
    // later lookup confidently wrong.
    if (!position || !positionById(position)) {
      reject('position is not a canonical taxonomy id', r.position);
      return;
    }

    const prescription = str(r.prescription);
    if (!prescription) {
      reject('prescription is empty — nothing to teach', r.prescription);
      return;
    }

    const quote = str(r.quote);
    if (!quote) {
      // Without a quote the record cannot be checked, which defeats the whole
      // review model.
      reject('quote is empty — record would be unverifiable', r.quote);
      return;
    }

    const startSeconds =
      typeof r.startSeconds === 'number' && Number.isFinite(r.startSeconds)
        ? Math.max(0, Math.floor(r.startSeconds))
        : null;
    if (startSeconds === null) {
      reject('startSeconds missing or not a number', r.startSeconds);
      return;
    }

    const pre = (r.preconditions ?? {}) as Record<string, unknown>;
    const giRaw = str(pre.gi).toLowerCase() || 'either';
    const levelRaw = str(pre.level).toLowerCase() || 'any';
    const gi = GI_SYNONYMS[giRaw] ?? giRaw;
    const level = LEVEL_SYNONYMS[levelRaw] ?? levelRaw;
    if (!GI_VALUES.has(gi)) {
      reject(`preconditions.gi must be gi | no-gi | either`, pre.gi);
      return;
    }
    if (!LEVELS.has(level)) {
      reject(`preconditions.level is not a known level`, pre.level);
      return;
    }

    valid.push({
      id: '', // assigned by assignIds
      position,
      prescription,
      why: str(r.why),
      detail: str(r.detail),
      counter: str(r.counter),
      preconditions: {
        gi: gi as Preconditions['gi'],
        level: level as Preconditions['level'],
        opponent: str(pre.opponent),
      },
      chapter: chapterFor(startSeconds),
      source: {
        ...source,
        startSeconds,
        timestamp: formatSeconds(startSeconds),
      },
      quote,
      certified: false,
      contested: false,
    });

    // Ships, but flagged: an unconditional "always/never" that does not say
    // when it applies cannot be safely combined with a record that says the
    // opposite (#102).
    const accepted = valid[valid.length - 1]!;
    if (isUnscopedAbsolute(accepted)) {
      warnings.push({
        index,
        reason: 'absolute prescription with no opponent precondition',
        offending: accepted.prescription,
      });
    }
  });

  return { valid, rejected, warnings };
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Assign deterministic ids: `{volumeSlug}-{mmss}`, with `-2`, `-3`… on
 * collision, in timestamp order.
 *
 * **What stability promises.** Given the same model output the ids are
 * identical, so re-processing a saved response never churns them. What it
 * cannot promise is that a fresh mining run of the same volume produces the
 * same timestamps — that is the model's judgement, and it varies. The real
 * guarantee against churn is not re-mining a volume that has not changed,
 * which is the batch runner's job.
 */
export function assignIds(
  records: MinedRecord[],
  volumeSlug: string,
): MinedRecord[] {
  const ordered = [...records].sort(
    (a, b) => a.source.startSeconds - b.source.startSeconds,
  );
  const used = new Map<string, number>();
  return ordered.map((r) => {
    const m = Math.floor(r.source.startSeconds / 60);
    const s = Math.floor(r.source.startSeconds % 60);
    const stem = `${volumeSlug}-${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
    const seen = (used.get(stem) ?? 0) + 1;
    used.set(stem, seen);
    return { ...r, id: seen === 1 ? stem : `${stem}-${seen}` };
  });
}

export interface ChapterCoverage {
  title: string;
  startSeconds: number;
  recordCount: number;
}

/**
 * Records per chapter, including the empty ones.
 *
 * This is the completeness check. A model handed a whole volume may summarise
 * rather than exhaust it, and a chapter that produced nothing is the visible
 * symptom. Free wherever a chapter index exists.
 */
export function chapterCoverage(
  records: MinedRecord[],
  chapters: { title: string; startSeconds: number }[],
): ChapterCoverage[] {
  return chapters.map((c, i) => {
    const next = chapters[i + 1];
    const end = next ? next.startSeconds : Infinity;
    return {
      title: c.title,
      startSeconds: c.startSeconds,
      recordCount: records.filter(
        (r) =>
          r.source.startSeconds >= c.startSeconds &&
          r.source.startSeconds < end,
      ).length,
    };
  });
}
