import { env } from '@/config/env';
import { ClaudeProvider } from '@/providers/ai/ClaudeProvider';
import { GeminiProvider } from '@/providers/ai/GeminiProvider';
import type { IAIProvider } from '@/providers/ai/IAIProvider';
import { OpenAIProvider } from '@/providers/ai/OpenAIProvider';

/**
 * AI provider selector. The active provider is chosen by `AI_PROVIDER` in env.
 * To add one: implement IAIProvider, add it to this map, set the env var.
 */
type ProviderFactory = () => IAIProvider;

const providers: Record<string, ProviderFactory> = {
  claude: () => new ClaudeProvider(),
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
};

function selectProvider(): IAIProvider {
  const factory = providers[env.AI_PROVIDER];
  if (!factory) {
    throw new Error(
      `Unknown AI_PROVIDER "${env.AI_PROVIDER}". ` +
        `Available: ${Object.keys(providers).join(', ')}.`,
    );
  }
  return factory();
}

export const aiProvider: IAIProvider = selectProvider();

export type {
  IAIProvider,
  ExtractionInput,
  ExtractionOutput,
  CoachingInput,
  CoachingOutput,
} from '@/providers/ai/IAIProvider';
