import { env } from '@/config/env';
import { GeminiTranscriptionProvider } from '@/providers/transcription/GeminiTranscriptionProvider';
import type { ITranscriptionProvider } from '@/providers/transcription/ITranscriptionProvider';
import { WhisperProvider } from '@/providers/transcription/WhisperProvider';

/**
 * Transcription provider selector. The active provider is chosen by
 * `TRANSCRIPTION_PROVIDER` in env. To add one: implement
 * ITranscriptionProvider, add it to this map, set the env var.
 */
type ProviderFactory = () => ITranscriptionProvider;

const providers: Record<string, ProviderFactory> = {
  whisper: () => new WhisperProvider(),
  gemini: () => new GeminiTranscriptionProvider(),
  // assemblyai: () => new AssemblyAIProvider(),  // TODO(future)
  // deepgram: () => new DeepgramProvider(),      // TODO(future)
};

function selectProvider(): ITranscriptionProvider {
  const factory = providers[env.TRANSCRIPTION_PROVIDER];
  if (!factory) {
    throw new Error(
      `Unknown TRANSCRIPTION_PROVIDER "${env.TRANSCRIPTION_PROVIDER}". ` +
        `Available: ${Object.keys(providers).join(', ')}.`,
    );
  }
  return factory();
}

export const transcriptionProvider: ITranscriptionProvider = selectProvider();

export type {
  ITranscriptionProvider,
  TranscriptionResult,
} from '@/providers/transcription/ITranscriptionProvider';
