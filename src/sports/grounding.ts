/**
 * Grounding selection — which instructional records reach the coaching prompt,
 * and how they are rendered (issue #41/#57).
 *
 * Dependency-free on purpose, with relative imports only: this file is imported
 * by BOTH the client reference implementation AND the Supabase edge function,
 * exactly like the sport prompts. The two must select and render identically —
 * a cue measured in one place means nothing if the other built a different
 * prompt. Keep it free of any `@/`, node, or React Native imports.
 */

import { normalizePosition } from './bjj/bjjPositions.ts';
import type { Perspective } from './positionTypes.ts';

/** Ceiling on how many records reach the prompt. */
export const GROUNDING_RECORD_LIMIT = 20;

/**
 * Minimum overlap with the key mistake before a record is worth injecting.
 *
 * A blind trial found that injecting the top 20 records for a position made
 * cues WORSE — the practitioner preferred the ungrounded cue two-to-one. The
 * records were about the right position and the wrong problem, and the model
 * dutifully built a specific cue around a mechanic that answered a different
 * question. Specificity is worthless if it is aimed elsewhere.
 *
 * So a record must share at least this many meaningful terms with the mistake.
 * Measured over the frozen baseline, a bar of 2 keeps 17 of 23 resolvable
 * sessions grounded while cutting the median injected set from 25 to 4.
 */
export const GROUNDING_MIN_RELEVANCE = 2;

/** The shape grounding needs. Structural so both sides can pass their own type. */
export interface GroundableRecord {
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
  /** Two or more reviewers called it sound (#77). Optional: absent = false. */
  certified?: boolean;
  /** Reviewers disagree (#77). Never grounds a cue unaided. */
  contested?: boolean;
  /** Two or more reviewers agree it is wrong (#77). Never grounds a cue. */
  rejected?: boolean;
}

/** The extraction fields grounding reads. */
export interface GroundableExtraction {
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  perspective: Perspective | 'unknown';
  /**
   * The transcript. Load-bearing, not decorative: the practitioner states which
   * side they were on far more often than the extracted summary does, and
   * without it a session resolves for storage but not for grounding.
   */
  rawTranscript: string;
}

/**
 * Canonical position ids this session might be grounded against.
 *
 * Every position mentioned is a candidate, not just one. The key mistake
 * usually concerns a single position, and ranking the records afterwards
 * settles which — whereas picking one up front would have to guess, and
 * guessing wrong grounds the cue in the wrong situation entirely.
 */
export function candidatePositions(extraction: GroundableExtraction): string[] {
  // Include the transcript. The extracted mistake is a tidy summary and
  // routinely drops the side — "unable to sweep from half guard" says nothing
  // about who was underneath, while the recording almost always does. Omitting
  // it made grounding strictly weaker than the storage-side resolution, so a
  // session could resolve to `half-guard-bottom` for the database and to
  // nothing at all for the prompt.
  const context = [
    extraction.keyMistake,
    extraction.opponentAction,
    extraction.rawTranscript,
  ]
    .filter(Boolean)
    .join(' ');
  const ids = new Set<string>();
  for (const raw of extraction.positionsVisited) {
    const match = normalizePosition(raw, context, extraction.perspective);
    if (match.id) ids.add(match.id);
  }
  return [...ids];
}

/**
 * Words common to almost every extracted mistake. They would dominate the
 * overlap score without distinguishing anything.
 */
const STOPWORDS = new Set([
  'practitioner',
  'opponent',
  'their',
  'them',
  'they',
  'this',
  'that',
  'with',
  'from',
  'when',
  'while',
  'unable',
  'failed',
  'could',
  'been',
  'being',
  'into',
  'onto',
  'were',
  'where',
  'which',
]);

/**
 * How much a matched term should count, by how rare it is in the pool.
 *
 * Plain inverse document frequency. A term in nearly every record ("escape",
 * "control") says almost nothing about which record to pick; one in a handful
 * ("kimura", "berimbolo") says almost everything. Computed over the CANDIDATE
 * pool rather than the whole store, because the pool is already narrowed to a
 * position and that is the set the choice is actually made within.
 */
function idf(term: string, pool: { haystack: string }[]): number {
  let df = 0;
  for (const entry of pool) if (entry.haystack.includes(term)) df++;
  return Math.log((pool.length + 1) / (df + 1));
}

/**
 * How much more a term from the sport's own vocabulary is worth.
 *
 * Rarity alone is not enough, and the case that showed it is exact: for
 * "failed to secure the Kimura, allowing the opponent to escape to Turtle",
 * `allowing` and `kimura` each appeared in exactly 13 of 295 candidate
 * records, so IDF scored them IDENTICALLY. `allowing+turtle` tied
 * `kimura+turtle` and file order picked the winner — a record about hip
 * connection outranked the one naming the technique.
 *
 * Rarity in the record store measures how unusual a word is, not how much it
 * identifies a technique. `allowing` is rare because it is connective tissue
 * from the mistake sentence; `kimura` is rare because few techniques are the
 * Kimura. The sport's vocabulary is what separates them, and 2 is enough:
 * a domain term beats a generic one of equal rarity without letting a single
 * common domain word ("guard") outweigh two specific ones.
 */
const DOMAIN_TERM_WEIGHT = 2;

/** The sport's vocabulary as single lowercase words, for term lookup. */
function domainWords(vocabulary: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const phrase of vocabulary) {
    for (const w of phrase.toLowerCase().split(/[^a-z]+/)) {
      if (w.length >= 4) out.add(w);
    }
  }
  return out;
}

/**
 * Rank by overlap with the key mistake, then cap.
 *
 * Cost is not the constraint — 20 records is ~2,100 tokens on a prompt that is
 * otherwise tiny. **Dilution** is: `half-guard-bottom` alone has 145 records,
 * and burying the one relevant correction among them makes the model pick
 * badly. Ranking is crude on purpose; it operates on a shortlist already
 * filtered by position and perspective, which does most of the work.
 *
 * Ties keep input order, so a stable input yields a stable prompt — an
 * unstable prompt makes before/after comparisons noisy for no reason.
 */
export function rankRecords<T extends GroundableRecord>(
  records: T[],
  keyMistake: string,
  limit: number = GROUNDING_RECORD_LIMIT,
  minRelevance: number = GROUNDING_MIN_RELEVANCE,
  /**
   * The sport's vocabulary, from `ISportContext.vocabulary`. Passed IN rather
   * than imported: this module is sport-agnostic and CLAUDE.md rule 3 keeps a
   * sport's vocabulary inside `src/sports/{sportKey}/`. Omitting it falls back
   * to rarity alone, which ranks worse but never wrongly.
   */
  vocabulary: readonly string[] = [],
): T[] {
  const terms = new Set(
    (keyMistake.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
      (w) => !STOPWORDS.has(w),
    ),
  );
  // Nothing to match against means we cannot tell relevance from irrelevance.
  // Injecting arbitrary records for the position is exactly what made cues
  // worse, so ground nothing instead.
  if (terms.size === 0) return [];
  const domain = domainWords(vocabulary);

  return (
    records
      // Human review outranks keyword overlap. A record reviewers called wrong
      // must never ground a cue however well it matches the mistake — matching
      // is a weak signal and being wrong is not.
      //
      // `contested` is excluded too: migration 008 said a contested position
      // should not ground a cue unaided, and nothing had honoured that. Two
      // black belts disagreeing is a finding about the mechanic, and building
      // a confident cue on it is exactly the failure grounding keeps producing.
      .filter((record) => !record.rejected && !record.contested)
      .map((record, index) => ({
        record,
        index,
        haystack:
          `${record.prescription} ${record.why} ${record.detail}`.toLowerCase(),
      }))
      .map((entry, _i, all) => {
        const matched = [...terms].filter((t) => entry.haystack.includes(t));
        return {
          record: entry.record,
          index: entry.index,
          // The GATE stays a plain count of distinct terms, unchanged.
          score: matched.length,
          // The ORDER is weighted by how rare each matched term is in this
          // pool. Counting every term equally is what let a nine-way tie
          // happen and be resolved by file order: for "failed to secure the
          // Kimura, allowing the opponent to escape to Turtle", nine records
          // scored exactly 2 and not one of them matched "kimura" — they
          // matched "allowing"+"turtle" and "allowing"+"escape". The record
          // that names the technique has to beat the record that shares a
          // filler word, and only rarity distinguishes them.
          //
          // A bigger store makes this worse rather than better, which is why
          // it surfaced when the corpus grew: more records clear a low bar,
          // and the tiebreak was never meaningful.
          weighted: matched.reduce(
            (sum, t) =>
              sum +
              idf(t, all as { haystack: string }[]) *
                (domain.has(t) ? DOMAIN_TERM_WEIGHT : 1),
            0,
          ),
        };
      })
      // The gate: a record about the right position but the wrong problem is
      // worse than no record, because the model will build a confident, specific
      // cue around it.
      .filter((entry) => entry.score >= minRelevance)
      // Certified first, then overlap, then input order. A tiebreak rather
      // than a gate: with 0 of 1,322 records certified, requiring
      // certification would ground nothing at all, so review improves ranking
      // smoothly instead of switching grounding off until the queue is done.
      .sort(
        (a, b) =>
          Number(b.record.certified ?? false) -
            Number(a.record.certified ?? false) ||
          b.weighted - a.weighted ||
          b.score - a.score ||
          a.index - b.index,
      )
      .slice(0, limit)
      .map((entry) => entry.record)
  );
}

/**
 * The block that replaces `{{GROUNDING}}` in the coaching prompt.
 *
 * Empty when ungrounded, so the prompt collapses back to exactly what it was —
 * an ungrounded cue must be indistinguishable from one the pipeline produced
 * before grounding existed.
 */
export function groundingSection(records: GroundableRecord[]): string {
  if (records.length === 0) return '';
  const lines = records.map((r) => {
    const parts = [`- ${r.prescription}`];
    if (r.why) parts.push(`  Why: ${r.why}`);
    if (r.detail) parts.push(`  Detail: ${r.detail}`);
    if (r.counter) parts.push(`  They counter with: ${r.counter}`);
    const when = [
      r.gi !== 'either' ? r.gi : '',
      r.level !== 'any' ? r.level : '',
      r.opponent,
    ]
      .filter(Boolean)
      .join(', ');
    if (when) parts.push(`  Applies when: ${when}`);
    return parts.join('\n');
  });
  // Guidance FIRST, records LAST (issue #71).
  //
  // A duplicate header used to sit between the two, so the records appeared
  // under the first header and the guidance then referred to "the mechanics
  // below" and "for each one" with nothing below it. The orphaned block was
  // the discard guidance — the part that tells the model several records will
  // be about the right position and the wrong problem, and that ignoring them
  // all is a correct outcome. That is exactly the instruction the blind trials
  // said was needed, attached to an empty list.
  //
  // The wording is unchanged on purpose. This is a structural fix, and it
  // lands as the A/B cohort opens; smuggling in a content rewrite would make
  // the first cohort measure two changes at once.
  return [
    '',
    '',
    'REFERENCE MECHANICS — how experienced instructors teach this position.',
    '',
    'THE MISTAKE IS THE JOB. Your cue must address what went wrong in THIS session.',
    'The mechanics below are offered as help, not as an assignment. They were selected',
    'because they mention some of the same things the mistake does, which is a weak',
    'signal — several of them will be about this position but not about this problem.',
    '',
    'For each one, ask: does this actually fix what went wrong? If yes, use its concrete',
    'detail — the grip, the direction, the body part — rather than the general principle',
    'behind it. If no, discard it.',
    '',
    'IF NONE OF THEM FIT, IGNORE THEM ALL and coach the mistake directly. That is a',
    'correct outcome, not a failure. A cue that addresses the real mistake in ordinary',
    'terms is far more useful than a precise cue aimed at a different problem — and',
    'aiming elsewhere is the most common way these notes get misused.',
    '',
    '- If a mechanic carries an "Applies when" line, honour it. One taught for beginners',
    '  is not automatically right for an advanced practitioner, and one that depends on a',
    '  grip only works when that grip is available.',
    '- Never mention these notes, where they came from, or that you were given references.',
    '',
    // Labelled, because the guidance above ends in bullets and each record
    // also starts with one — without a boundary the two read as a single list
    // and the records become more instructions to follow rather than notes to
    // weigh and discard.
    'THE MECHANICS:',
    '',
    lines.join('\n'),
  ].join('\n');
}
