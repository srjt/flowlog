import type {
  ITranscriptionProvider,
  TranscriptionResult,
} from '@/providers/transcription/ITranscriptionProvider';

/**
 * Full-interface transcription mock. Configure the result; assert on calls.
 * Shared across test files — never inline a provider mock in a test.
 */
export class MockTranscriptionProvider implements ITranscriptionProvider {
  available = true;
  calls: { audioUri: string; vocabulary?: string[] }[] = [];

  constructor(
    public result: TranscriptionResult = {
      transcript:
        'Rolled five rounds. Got my back taken twice from turtle because I exposed my neck. Felt flat.',
      confidence: 0.9,
      detectedTerms: ['Turtle', 'Back Control'],
      durationSeconds: 65,
    },
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async transcribe(
    audioUri: string,
    vocabulary?: string[],
  ): Promise<TranscriptionResult> {
    this.calls.push({ audioUri, vocabulary });
    return this.result;
  }
}
