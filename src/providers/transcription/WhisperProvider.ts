import { Platform } from 'react-native';

import { env } from '@/config/env';
import type {
  ITranscriptionProvider,
  TranscriptionResult,
} from '@/providers/transcription/ITranscriptionProvider';
import { logCost } from '@/utils/cost';
import { logger } from '@/utils/logger';

const OPENAI_TRANSCRIPTION_URL =
  'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const WHISPER_COST_PER_MINUTE = 0.006;

/**
 * OpenAI Whisper transcription provider.
 *
 * Uploads the recorded audio file as multipart/form-data and requests a
 * verbose JSON response so we get per-call duration and (where available)
 * segment data. Sport vocabulary is injected via the `prompt` parameter, which
 * biases Whisper toward domain terminology.
 */
export class WhisperProvider implements ITranscriptionProvider {
  private readonly apiKey: string;

  constructor(apiKey: string = env.OPENAI_API_KEY) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async transcribe(
    audioUri: string,
    vocabulary: string[] = [],
  ): Promise<TranscriptionResult> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'WhisperProvider unavailable: OPENAI_API_KEY is not configured.',
      );
    }

    const form = new FormData();
    await this.appendAudio(form, audioUri);
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'verbose_json');
    if (vocabulary.length > 0) {
      // Whisper "prompt" biases recognition toward these terms.
      form.append('prompt', this.buildVocabularyPrompt(vocabulary));
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (err) {
      logger.error('WhisperProvider network error', err);
      throw new Error('Whisper transcription failed: network error.');
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(
        `Whisper transcription failed: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as WhisperVerboseResponse;
    const transcript = (data.text ?? '').trim();
    const durationSeconds = data.duration ?? 0;
    const confidence = this.estimateConfidence(data);
    const detectedTerms = this.detectTerms(transcript, vocabulary);

    logCost(
      'whisper',
      (durationSeconds / 60) * WHISPER_COST_PER_MINUTE,
    );

    return { transcript, confidence, detectedTerms, durationSeconds };
  }

  /**
   * Attach the audio to the form. On web the recording is a blob: URL produced
   * by MediaRecorder (webm/ogg), so we fetch the real Blob and use its mime.
   * On native, FormData accepts a { uri, name, type } descriptor.
   */
  private async appendAudio(form: FormData, audioUri: string): Promise<void> {
    if (Platform.OS === 'web') {
      const res = await fetch(audioUri);
      const blob = await res.blob();
      const subtype = (blob.type.split('/')[1] ?? 'webm').split(';')[0];
      form.append('file', blob, `session.${subtype || 'webm'}`);
      return;
    }
    form.append('file', {
      uri: audioUri,
      name: 'session.m4a',
      type: 'audio/m4a',
    } as unknown as Blob);
  }

  /** Whisper's prompt is capped (~224 tokens); send the most useful terms. */
  private buildVocabularyPrompt(vocabulary: string[]): string {
    const terms = vocabulary.slice(0, 120).join(', ');
    return `This is a sports training reflection. Relevant terminology: ${terms}.`;
  }

  /**
   * Whisper verbose JSON exposes per-segment avg_logprob. We convert the mean
   * log-probability into a rough 0–1 confidence. When segments are absent we
   * fall back to a neutral-high default.
   */
  private estimateConfidence(data: WhisperVerboseResponse): number {
    const segments = data.segments ?? [];
    if (segments.length === 0) return 0.85;
    const meanLogProb =
      segments.reduce((sum, s) => sum + (s.avg_logprob ?? -0.3), 0) /
      segments.length;
    // avg_logprob is typically in [-1, 0]; map to [0, 1].
    return Math.max(0, Math.min(1, 1 + meanLogProb));
  }

  /** Which of the primed vocabulary terms actually appear in the transcript. */
  private detectTerms(transcript: string, vocabulary: string[]): string[] {
    const hay = transcript.toLowerCase();
    return vocabulary.filter((term) => hay.includes(term.toLowerCase()));
  }
}

interface WhisperSegment {
  avg_logprob?: number;
}
interface WhisperVerboseResponse {
  text?: string;
  duration?: number;
  segments?: WhisperSegment[];
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}
