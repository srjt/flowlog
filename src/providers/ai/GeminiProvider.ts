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

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const EXTRACTION_COST_PER_CALL = 0.003;
const COACHING_COST_PER_CALL = 0.002;

const STRICT_RETRY_SUFFIX = `

RETRY — the previous cue was rejected for being too long, too generic, or too low-confidence. Rewrite it UNDER the word limit, hyper-specific to one mechanical detail, and directly tied to the key mistake. Do not output generic motivational advice.`;

/**
 * Google Gemini AI provider — full implementation of both pipeline stages.
 *
 * Calls the generativelanguage `generateContent` endpoint with the API key as a
 * query param (browser-compatible — works from the web client in the local test
 * pipeline). Requests `responseMimeType: application/json` so Gemini returns the
 * strict JSON our prompts ask for. Holds no sport logic; the sport context
 * supplies the prompts. Model is configurable via `EXPO_PUBLIC_GEMINI_MODEL`.
 */
export class GeminiProvider implements IAIProvider {
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

  async extract(input: ExtractionInput): Promise<ExtractionOutput> {
    const prompt = this.fillTemplate(input.sportContext.extractionPrompt, {
      TRANSCRIPT: input.transcript,
      BELT_LEVEL: input.beltLevel,
      SKILL_LEVEL: input.beltLevel,
      SENTIMENT_LABELS: input.sportContext.sentimentLabels.join(', '),
    });

    const text = await this.complete(prompt, 8192);
    logCost('gemini:extraction', EXTRACTION_COST_PER_CALL);

    const parsed = this.parseJson<Partial<ExtractionOutput>>(text);
    return {
      positionsVisited: Array.isArray(parsed.positionsVisited)
        ? parsed.positionsVisited
        : [],
      keyMistake: parsed.keyMistake ?? '',
      opponentAction: parsed.opponentAction ?? '',
      sentiment: parsed.sentiment ?? 'neutral',
      rawTranscript: input.transcript,
    };
  }

  async generateCoachingCue(input: CoachingInput): Promise<CoachingOutput> {
    const base = this.fillTemplate(input.sportContext.coachingPrompt, {
      SKILL_LEVEL: input.skillLevel,
      KEY_MISTAKE: input.extraction.keyMistake,
      OPPONENT_ACTION: input.extraction.opponentAction,
      POSITIONS_VISITED: input.extraction.positionsVisited.join(', ') || 'none',
      RECENT_MISTAKES: input.recentMistakes.join('; ') || 'none recorded',
      DOMINANT_WEAKNESS: input.dominantWeakness ?? 'not yet established',
      MAX_WORDS: String(PIPELINE_CONFIG.coachingCueMaxWords),
    });
    const suffix = input.strict ? STRICT_RETRY_SUFFIX : '';

    const text = await this.complete(base + suffix, 4096);
    logCost('gemini:coaching', COACHING_COST_PER_CALL);

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
  private async complete(
    prompt: string,
    maxOutputTokens: number,
  ): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'GeminiProvider unavailable: GEMINI_API_KEY is not configured.',
      );
    }

    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens,
            temperature: 0.4,
          },
        }),
      });
    } catch (err) {
      logger.error('GeminiProvider network error', err);
      throw new Error('Gemini request failed: network error.');
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(`Gemini request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned no text content.');
    }
    return text;
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

  private parseJson<T>(text: string): T {
    const fenced = text.replace(/```json|```/g, '');
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Gemini returned malformed JSON: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(fenced.slice(start, end + 1)) as T;
    } catch {
      throw new Error(
        `Gemini returned unparseable JSON: ${text.slice(0, 200)}`,
      );
    }
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}
