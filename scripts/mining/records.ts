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
}

const GI_VALUES = new Set(['gi', 'no-gi', 'either']);
const LEVELS = new Set(['beginner', 'intermediate', 'advanced', 'any']);

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
    const gi = str(pre.gi) || 'either';
    const level = str(pre.level) || 'any';
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
  });

  return { valid, rejected };
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
