import type { ISportContext } from '@/sports/ISportContext';
import { transcriptionProvider } from '@/providers/transcription';
import type {
  ITranscriptionProvider,
  TranscriptionResult,
} from '@/providers/transcription';
import { logger } from '@/utils/logger';

/** Thrown when the recording is shorter than the sport's minimum. */
export class RecordingTooShortError extends Error {
  constructor(durationSeconds: number, minSeconds: number) {
    super(
      `Recording too short: ${durationSeconds.toFixed(1)}s (minimum ${minSeconds}s).`,
    );
    this.name = 'RecordingTooShortError';
  }
}

/**
 * Stage 1 — transcription. Wraps the transcription provider, primes it with the
 * active sport's vocabulary, and enforces the minimum recording length so junk
 * input never reaches the AI stages. Provider is injected for testability.
 */
export class TranscriptionService {
  constructor(
    private readonly provider: ITranscriptionProvider = transcriptionProvider,
  ) {}

  async transcribe(
    audioUri: string,
    sportContext: ISportContext,
  ): Promise<TranscriptionResult> {
    const result = await this.provider.transcribe(
      audioUri,
      sportContext.vocabulary,
    );

    if (
      result.durationSeconds > 0 &&
      result.durationSeconds < sportContext.minRecordingSeconds
    ) {
      throw new RecordingTooShortError(
        result.durationSeconds,
        sportContext.minRecordingSeconds,
      );
    }

    if (result.transcript.trim().length === 0) {
      throw new Error('Transcription produced empty text.');
    }

    logger.debug('transcription complete', {
      durationSeconds: result.durationSeconds,
      detected: result.detectedTerms.length,
      confidence: result.confidence,
    });

    return result;
  }
}
