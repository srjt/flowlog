// SDK 54: the classic readAsStringAsync/EncodingType API now lives under /legacy.
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { env } from '@/config/env';
import type {
  ITranscriptionProvider,
  TranscriptionResult,
} from '@/providers/transcription/ITranscriptionProvider';
import {
  arrayBufferToBase64,
  encodeToWav16kMono,
} from '@/utils/audioTranscode';
import { logger } from '@/utils/logger';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Transcription via Gemini's audio understanding (`generateContent` with an
 * inline audio part). Lets the whole pipeline run on a single Gemini key — no
 * OpenAI/Whisper.
 *
 * Gemini accepts wav/mp3/aiff/aac/ogg/flac but NOT webm, which is what the
 * browser's MediaRecorder produces. So on web we decode the recording and
 * re-encode it to 16 kHz mono WAV (Gemini downsamples to 16 kHz mono anyway)
 * before sending. On native we send the recorded file as-is.
 */
export class GeminiTranscriptionProvider implements ITranscriptionProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    apiKey: string = env.GEMINI_API_KEY,
    model: string = env.GEMINI_MODEL,
  ) {
    this.apiKey = apiKey;
    this.model = model;
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
        'GeminiTranscriptionProvider unavailable: GEMINI_API_KEY is not configured.',
      );
    }

    const { base64, mimeType } = await this.loadAudio(audioUri);

    const prompt =
      'Generate a verbatim transcript of the speech in this audio. It is a ' +
      'short post-training spoken reflection by an athlete. Domain terms that ' +
      `may appear: ${vocabulary.slice(0, 120).join(', ')}. Return ONLY the ` +
      'transcript text — no labels, no timestamps, no commentary.';

    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      logger.error('GeminiTranscriptionProvider network error', err);
      throw new Error('Gemini transcription failed: network error.');
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(`Gemini transcription failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const transcript = (
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    ).trim();
    if (transcript.length === 0) {
      throw new Error('Gemini returned an empty transcript.');
    }

    const hay = transcript.toLowerCase();
    const detectedTerms = vocabulary.filter((t) =>
      hay.includes(t.toLowerCase()),
    );

    return { transcript, confidence: 0.9, detectedTerms, durationSeconds: 0 };
  }

  /**
   * Load the audio as base64 in a Gemini-supported format. Protected so tests
   * can override it without the Web Audio API.
   */
  protected async loadAudio(
    audioUri: string,
  ): Promise<{ base64: string; mimeType: string }> {
    if (Platform.OS === 'web') {
      const wav = await encodeToWav16kMono(
        await (await fetch(audioUri)).arrayBuffer(),
      );
      return { base64: arrayBufferToBase64(wav), mimeType: 'audio/wav' };
    }
    // Native: send the recorded file as-is (expo-av HIGH_QUALITY ⇒ m4a/aac).
    const base64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64, mimeType: 'audio/aac' };
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}
