import { aiProvider } from '@/providers/ai';
import type { IAIProvider } from '@/providers/ai';
import type { ISportContext } from '@/sports/ISportContext';
import type { ExtractionOutput } from '@/types/pipeline';
import { logger } from '@/utils/logger';

/**
 * Stage 2a — structured extraction. Turns the raw transcript into strict
 * structured data using the sport's extraction prompt. Deliberately does NOT
 * generate coaching — that separation is a core architectural decision
 * (see docs/adr/0002-two-stage-ai-pipeline.md). Provider is injected for testability.
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

    logger.debug('extraction complete', {
      positions: extraction.positionsVisited.length,
      sentiment,
    });

    return { ...extraction, sentiment, rawTranscript: transcript };
  }
}
