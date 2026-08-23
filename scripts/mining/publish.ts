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
  'Mateus',
  'Matace', // recurring mis-transcription of the same name
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
export const SOURCE_MARKERS: RegExp[] = [
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
