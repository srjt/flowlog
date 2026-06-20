import type { TranscriptionResult } from '@/types/pipeline';

export type { TranscriptionResult };

/**
 * Transcription provider contract. Implementations turn an audio file into
 * text, optionally primed with sport vocabulary so domain terms are
 * recognised. Swappable via env (`TRANSCRIPTION_PROVIDER`).
 */
export interface ITranscriptionProvider {
  /**
   * Transcribe the audio at `audioUri`. `vocabulary` is a list of domain terms
   * used to bias recognition toward the active sport's language.
   */
  transcribe(
    audioUri: string,
    vocabulary?: string[],
  ): Promise<TranscriptionResult>;

  /** Cheap liveness/credentials check used by the pipeline before relying on it. */
  isAvailable(): Promise<boolean>;
}
