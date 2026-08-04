/**
 * Builds the image-generation prompt for a coaching cue (ADR 0012).
 *
 * The HOUSE STYLE lives here (one fixed look, so the shared catalog reads as a
 * coherent set); the sport-specific subject comes from `styleHint`
 * (`ISportContext.imageStyleHint`). Deliberately instructs NO text in the
 * image — model text rendering is unreliable and the cue already renders as
 * real text beside the image, which also keeps images language-agnostic.
 *
 * Pure and dependency-free so it is single-sourced by both the `src/` reference
 * service and the `supabase/functions/_shared` edge mirror.
 */

/** Fixed house style appended to every prompt. Bump-safe: changing this text
 *  does NOT change reuse keys, so pair any style change with a KEY_VERSION bump
 *  in `cueImageKey.ts` if you want old images regenerated. */
const HOUSE_STYLE =
  'Flat, minimal instructional line diagram, clean neutral background, ' +
  'limited muted palette, soft shapes, single clear focal action, ' +
  'no text, no words, no letters, no numbers, no logos, no watermark.';

export interface CueImagePromptInput {
  cue: string;
  targetPosition: string | null | undefined;
  /** `ISportContext.imageStyleHint` — the sport-specific subject. */
  styleHint: string;
}

export function buildCueImagePrompt(input: CueImagePromptInput): string {
  const position = (input.targetPosition ?? '').trim();
  const focus = position
    ? `The scene depicts the "${position}" position. `
    : '';
  return [
    input.styleHint.trim(),
    `${focus}Illustrate this coaching cue as a single body mechanic: "${input.cue.trim()}".`,
    HOUSE_STYLE,
  ].join(' ');
}
