import { aiProvider } from '@/providers/ai';
import type { IAIProvider } from '@/providers/ai';
import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import type { CoachingInput, CoachingOutput } from '@/types/pipeline';
import { logger } from '@/utils/logger';

/**
 * Stage 2b — coaching generation. Produces ONE mechanical cue from the
 * structured extraction (never the raw transcript). Enforces the 25-word cap
 * at the service level — the AI prompt also enforces it, per the
 * "enforce in both places" rule (CLAUDE.md rule 6). Provider is injected for
 * testability.
 */
export class CoachingService {
  constructor(private readonly provider: IAIProvider = aiProvider) {}

  /** Generate a cue. Pass `strict` to request a shorter, more specific retry. */
  async generate(
    input: CoachingInput,
    strict = false,
  ): Promise<CoachingOutput> {
    const output = await this.provider.generateCoachingCue({
      ...input,
      strict,
    });
    const cue = output.cue.trim();

    logger.debug('coaching generated', {
      words: CoachingService.countWords(cue),
      confidence: output.confidenceScore,
      strict,
    });

    return { ...output, cue };
  }

  // ── Word-cap enforcement (service-level half of the hard cap) ─────────────
  static countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }

  static exceedsWordCap(
    text: string,
    maxWords: number = PIPELINE_CONFIG.coachingCueMaxWords,
  ): boolean {
    return CoachingService.countWords(text) > maxWords;
  }

  /**
   * Last-resort truncation used only for the fallback path so the UI never
   * shows an over-length cue even when every retry failed.
   */
  static truncateToWordCap(
    text: string,
    maxWords: number = PIPELINE_CONFIG.coachingCueMaxWords,
  ): string {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text.trim();
    return words.slice(0, maxWords).join(' ');
  }
}
