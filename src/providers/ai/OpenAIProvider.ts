import { env } from '@/config/env';
import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
  IAIProvider,
} from '@/providers/ai/IAIProvider';

/**
 * OpenAI chat AI provider — STUB.
 *
 * A complete structural stub that satisfies IAIProvider so it can be selected
 * via `AI_PROVIDER=openai`, but every integration point is a TODO. Mirror
 * ClaudeProvider when implementing: fill the sport prompt template, call the
 * Chat Completions API, parse strict JSON.
 */
export class OpenAIProvider implements IAIProvider {
  private readonly apiKey: string;

  constructor(apiKey: string = env.OPENAI_CHAT_API_KEY) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    // TODO(openai): optionally ping the models endpoint to verify the key.
    return this.apiKey.trim().length > 0;
  }

  async extract(_input: ExtractionInput): Promise<ExtractionOutput> {
    // TODO(openai): fill _input.sportContext.extractionPrompt, call
    // https://api.openai.com/v1/chat/completions with response_format
    // json_object, parse into ExtractionOutput.
    throw new Error(
      'OpenAIProvider.extract is not implemented. Set AI_PROVIDER=claude or implement this stub.',
    );
  }

  async generateCoachingCue(_input: CoachingInput): Promise<CoachingOutput> {
    // TODO(openai): fill _input.sportContext.coachingPrompt, enforce the
    // 25-word cap in the prompt, call the API, parse into CoachingOutput.
    throw new Error(
      'OpenAIProvider.generateCoachingCue is not implemented. Set AI_PROVIDER=claude or implement this stub.',
    );
  }
}
