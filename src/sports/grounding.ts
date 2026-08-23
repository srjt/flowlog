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

/** How many records reach the prompt. */
export const GROUNDING_RECORD_LIMIT = 20;

/** The shape grounding needs. Structural so both sides can pass their own type. */
export interface GroundableRecord {
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  gi: string;
  level: string;
  opponent: string;
}

/** The extraction fields grounding reads. */
export interface GroundableExtraction {
  positionsVisited: string[];
  keyMistake: string;
  opponentAction: string;
  perspective: Perspective | 'unknown';
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
  const context = [extraction.keyMistake, extraction.opponentAction]
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
): T[] {
  const terms = new Set(
    (keyMistake.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
      (w) => !STOPWORDS.has(w),
    ),
  );
  if (terms.size === 0) return records.slice(0, limit);

  return records
    .map((record, index) => {
      const haystack =
        `${record.prescription} ${record.why} ${record.detail}`.toLowerCase();
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score++;
      return { record, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.record);
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
  return [
    '',
    '',
    'REFERENCE MECHANICS for this position, as experienced instructors teach it:',
    lines.join('\n'),
    '',
    'USING THE REFERENCE MECHANICS (when the input includes them):',
    '',
    'The reference mechanics are how experienced instructors teach this exact position.',
    'Ground your cue in them: they exist because coaching written from general knowledge is',
    'frequently wrong in ways that read perfectly well.',
    '',
    "- Prefer a mechanic that addresses THIS practitioner's key mistake over one that is",
    '  merely about the same position. Relevance beats completeness.',
    '- Do NOT copy a mechanic verbatim, and do not stitch several together. Write one cue, in',
    "  your own words, for this person's situation.",
    '- If a mechanic carries an "Applies when" line, honour it. A mechanic taught for',
    '  beginners is not automatically right for an advanced practitioner, and one that',
    '  depends on a grip only works when that grip is available.',
    '- If NONE of the mechanics fit the mistake described, say what the mistake actually',
    '  calls for instead. A cue that is relevant and unsupported beats a cue that is',
    '  supported and beside the point.',
    '- Never mention these notes, where they came from, or that you were given references.',
  ].join('\n');
}
