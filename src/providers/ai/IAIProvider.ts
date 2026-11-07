import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
} from '@/types/pipeline';
import type { SpecRequest } from '@/visualization/diagramStage';

export type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
  SpecRequest,
};

/**
 * AI provider contract. Implementations run the AI stages:
 *  - `extract`: transcript -> structured JSON (no coaching)
 *  - `generateCoachingCue`: structured JSON + history -> one <=25-word cue
 *  - `generateDiagramSpec`: a built spec prompt -> the model's raw answer
 *    (#135), for the best-effort stage after the quality gate
 *
 * Swappable via env (`AI_PROVIDER`). Sport-specific prompts are supplied by the
 * caller through `input.sportContext`, so providers contain zero sport logic.
 */
export interface IAIProvider {
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
  generateCoachingCue(input: CoachingInput): Promise<CoachingOutput>;
  /**
   * Send a cue -> spec prompt (`runDiagramStage` builds it) and return the
   * model's raw answer: text, or an already-parsed object. Mirrors
   * `generateDiagramSpec` in `supabase/functions/_shared/ai.ts`.
   *
   * NEVER throws. Resolves to null when there is no answer (no key, a network
   * or HTTP failure, an empty body, or `input.timeoutMs` elapsing, which also
   * aborts the request). Parsing and validation are not the provider's job:
   * `parseSpecResponse` is the floor for every answer, whatever it is.
   */
  generateDiagramSpec(input: SpecRequest): Promise<unknown>;
  isAvailable(): Promise<boolean>;
}
