/**
 * Sport-agnostic position vocabulary types.
 *
 * The pipeline reads positions only through the active Sport context
 * (CLAUDE.md rule 3), so the shapes it needs cannot live in a sport's own
 * folder. Each sport supplies its own list and its own normalizer; nothing
 * here knows what a guard is.
 *
 * Dependency-free on purpose: imported by BOTH the client sport contexts AND
 * the Supabase edge function. Keep it free of any `@/`, node, or React Native
 * imports.
 */

/**
 * Which side of a position the practitioner was on. Roles, not elevation:
 * `top` controls, `bottom` is contained, `neutral` has no meaningful sides.
 * Each sport documents what these mean in its own terms.
 */
export type Perspective = 'top' | 'bottom' | 'neutral';

/** One canonical position in a sport's vocabulary. */
export interface SportPosition {
  /** Stable id. The contract everything else keys on. */
  id: string;
  /** Stem shared by a position's perspectives. */
  base: string;
  /** Human-readable name. */
  label: string;
  perspective: Perspective;
}

/**
 * Result of normalising free text onto a sport's vocabulary.
 *
 * `id` is non-null ONLY when the position is fully determined. Callers key on
 * `id` and abstain when it is null — the partial fields are for diagnostics and
 * for telling a user what was missing, never for guessing.
 */
export interface PositionMatch {
  id: string | null;
  base: string | null;
  label: string | null;
  perspective: Perspective | 'unknown';
}

/**
 * Map free text onto a canonical position. `context` supplies extra text (the
 * key mistake, the transcript) to read the side from when the position phrase
 * alone is silent.
 */
export type PositionNormalizer = (
  input: string | null | undefined,
  context?: string,
) => PositionMatch;
