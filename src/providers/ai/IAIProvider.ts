import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
} from '@/types/pipeline';

export type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
};

/**
 * AI provider contract. Implementations run the two AI stages:
 *  - `extract`: transcript -> structured JSON (no coaching)
 *  - `generateCoachingCue`: structured JSON + history -> one <=25-word cue
 *
 * Swappable via env (`AI_PROVIDER`). Sport-specific prompts are supplied by the
 * caller through `input.sportContext`, so providers contain zero sport logic.
 */
export interface IAIProvider {
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
  generateCoachingCue(input: CoachingInput): Promise<CoachingOutput>;
  isAvailable(): Promise<boolean>;
}
