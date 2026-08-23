import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import { aiProvider } from '@/providers/ai';
import type { IAIProvider } from '@/providers/ai';
import type { ISportContext } from '@/sports/ISportContext';
import type { Perspective } from '@/sports/positionTypes';
import type { ExtractionOutput } from '@/types/pipeline';
import { logger } from '@/utils/logger';

/**
 * Stage 2a — structured extraction. Turns the raw transcript into strict
 * structured data using the sport's extraction prompt. Deliberately does NOT
 * generate coaching — that separation is a core architectural decision
 * (see docs/adr/0002-two-stage-ai-pipeline.md). Provider is injected for testability.
 *
 * Also owns the SUFFICIENCY decision (issue #44): whether the transcript
 * described anything coachable at all. Two independent checks, both of which
 * must pass:
 *
 *   1. The model's own judgement (`hasCoachableContent` in the prompt schema).
 *   2. A word-count backstop that cannot be talked out of its answer.
 *
 * The backstop exists because the model check is itself a model call and can be
 * fooled; the model check exists because word count is a crude proxy that would
 * throw away a short-but-concrete reflection. Requiring both is what keeps a
 * fabricated cue from reaching a user.
 */
export class ExtractionService {
  constructor(private readonly provider: IAIProvider = aiProvider) {}

  async extract(
    transcript: string,
    sportContext: ISportContext,
    skillLevel: string,
  ): Promise<ExtractionOutput> {
    const extraction = await this.provider.extract({
      transcript,
      sportContext,
      beltLevel: skillLevel,
    });

    // Normalise: guarantee the sentiment is one the sport actually allows.
    const sentiment = sportContext.sentimentLabels.includes(
      extraction.sentiment,
    )
      ? extraction.sentiment
      : 'neutral';

    const perspective = ExtractionService.normalisePerspective(
      extraction.perspective,
    );

    const sufficiency = ExtractionService.judgeSufficiency(
      transcript,
      extraction.hasCoachableContent,
      extraction.insufficientReason,
    );

    logger.debug('extraction complete', {
      positions: extraction.positionsVisited.length,
      sentiment,
      perspective,
      hasCoachableContent: sufficiency.hasCoachableContent,
    });

    return {
      ...extraction,
      sentiment,
      perspective,
      rawTranscript: transcript,
      ...sufficiency,
    };
  }

  /**
   * Constrain the model's reported side to the values we accept (issue #48).
   *
   * Anything unexpected — a missing field, 'neutral', prose, a hallucinated
   * value — becomes `'unknown'`. Downstream that means the position resolves to
   * no canonical id and grounding abstains, which is the correct outcome. The
   * one thing that must never happen is an invalid value being trusted through
   * and producing coaching aimed at the wrong side of the position.
   */
  static normalisePerspective(value: unknown): Perspective | 'unknown' {
    return value === 'top' || value === 'bottom' ? value : 'unknown';
  }

  // ── Sufficiency (issue #44) ───────────────────────────────────────────────

  static countWords(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }

  /**
   * Combine the model's judgement with the word-count backstop.
   *
   * A missing/undefined model verdict is treated as `true` so that a provider
   * which hasn't been updated yet degrades to today's behaviour rather than
   * declining everything — the backstop still applies.
   */
  static judgeSufficiency(
    transcript: string,
    modelVerdict: boolean | undefined,
    modelReason: string | undefined,
    minWords: number = PIPELINE_CONFIG.minTranscriptWords,
  ): { hasCoachableContent: boolean; insufficientReason: string } {
    const words = ExtractionService.countWords(transcript);

    if (words < minWords) {
      return {
        hasCoachableContent: false,
        // Prefer the model's phrasing when it also declined — it is specific
        // about what was missing; fall back to the mechanical reason.
        insufficientReason:
          modelVerdict === false && modelReason?.trim()
            ? modelReason.trim()
            : 'the recording was too short to work from',
      };
    }

    if (modelVerdict === false) {
      return {
        hasCoachableContent: false,
        insufficientReason: modelReason?.trim() || 'no training was described',
      };
    }

    return { hasCoachableContent: true, insufficientReason: '' };
  }
}
