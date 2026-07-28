import { env } from '@/config/env';
import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import type {
  CoachingInput,
  CoachingOutput,
  ExtractionInput,
  ExtractionOutput,
  IAIProvider,
} from '@/providers/ai/IAIProvider';
import { logCost } from '@/utils/cost';
import { logger } from '@/utils/logger';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const EXTRACTION_COST_PER_CALL = 0.004;
const COACHING_COST_PER_CALL = 0.003;

/**
 * Universal strict-retry instruction appended when a coaching attempt is
 * rejected by the quality gate. Sport-agnostic so it works for every sport.
 */
const STRICT_RETRY_SUFFIX = `

RETRY — the previous cue was rejected for being too long, too generic, or too low-confidence. Rewrite it UNDER the word limit, hyper-specific to one mechanical detail, and directly tied to the key mistake. Do not output generic motivational advice.`;

/**
 * Anthropic Claude AI provider — full implementation of both pipeline stages.
 *
 * Each stage fills its sport-specific prompt template (from the supplied
 * sport context), calls the Messages API, and parses strict JSON out of the
 * response. The provider holds NO sport logic and NO coaching word-count logic
 * beyond instructing the model — enforcement lives in CoachingService.
 */
export class ClaudeProvider implements IAIProvider {
  private readonly apiKey: string;

  constructor(apiKey: string = env.ANTHROPIC_API_KEY) {
    this.apiKey = apiKey;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    const prompt = this.fillTemplate(input.sportContext.extractionPrompt, {
      TRANSCRIPT: input.transcript,
      BELT_LEVEL: input.beltLevel,
      SKILL_LEVEL: input.beltLevel,
      SENTIMENT_LABELS: input.sportContext.sentimentLabels.join(', '),
    });

    const text = await this.complete(prompt, 1024);
    logCost('claude:extraction', EXTRACTION_COST_PER_CALL);

    const parsed = this.parseJson<Partial<ExtractionOutput>>(text);
    return {
      positionsVisited: Array.isArray(parsed.positionsVisited)
        ? parsed.positionsVisited
        : [],
      keyMistake: parsed.keyMistake ?? '',
      opponentAction: parsed.opponentAction ?? '',
      sentiment: parsed.sentiment ?? 'neutral',
      // Always trust our own transcript over the model's echo.
      rawTranscript: input.transcript,
    };
  }

  async generateCoachingCue(input: CoachingInput): Promise<CoachingOutput> {
    const strictSuffix = input.strict ? STRICT_RETRY_SUFFIX : '';
    const base = this.fillTemplate(input.sportContext.coachingPrompt, {
      SKILL_LEVEL: input.skillLevel,
      KEY_MISTAKE: input.extraction.keyMistake,
      OPPONENT_ACTION: input.extraction.opponentAction,
      POSITIONS_VISITED: input.extraction.positionsVisited.join(', ') || 'none',
      RECENT_MISTAKES: input.recentMistakes.join('; ') || 'none recorded',
      DOMINANT_WEAKNESS: input.dominantWeakness ?? 'not yet established',
      MAX_WORDS: String(PIPELINE_CONFIG.coachingCueMaxWords),
    });

    const text = await this.complete(base + strictSuffix, 512);
    logCost('claude:coaching', COACHING_COST_PER_CALL);

    const parsed = this.parseJson<Partial<CoachingOutput>>(text);
    return {
      cue: (parsed.cue ?? '').trim(),
      targetPosition: parsed.targetPosition ?? '',
      confidenceScore:
        typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0,
      isGeneric: parsed.isGeneric === true,
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────
  private async complete(prompt: string, maxTokens: number): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'ClaudeProvider unavailable: ANTHROPIC_API_KEY is not configured.',
      );
    }

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // Required for direct browser calls (local test pipeline on web).
          // Harmless when called server-side.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (err) {
      logger.error('ClaudeProvider network error', err);
      throw new Error('Claude request failed: network error.');
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(`Claude request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const block = data.content?.find((b) => b.type === 'text');
    if (!block?.text) {
      throw new Error('Claude returned no text content.');
    }
    return block.text;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private fillTemplate(
    template: string,
    values: Record<string, string>,
  ): string {
    return Object.entries(values).reduce(
      (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
      template,
    );
  }

  /**
   * Robust JSON extraction: models sometimes wrap JSON in prose or code fences.
   * We grab the first balanced `{...}` block and parse it.
   */
  private parseJson<T>(text: string): T {
    const fenced = text.replace(/```json|```/g, '');
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Claude returned malformed JSON: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(fenced.slice(start, end + 1)) as T;
    } catch {
      throw new Error(
        `Claude returned unparseable JSON: ${text.slice(0, 200)}`,
      );
    }
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}
