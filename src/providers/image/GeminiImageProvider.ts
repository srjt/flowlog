import { env } from '@/config/env';
import type {
  IImageProvider,
  ImageGenInput,
  ImageGenOutput,
} from '@/providers/image/IImageProvider';
import { logCost } from '@/utils/cost';
import { logger } from '@/utils/logger';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Rough per-image cost for logging; Gemini flash-image ~$0.04, Imagen ~$0.02.
const IMAGE_COST_PER_CALL = 0.04;

/**
 * Google image generation via the Gemini API (ADR 0012). Reuses
 * `GEMINI_API_KEY` — the production pipeline already runs on Gemini, so no new
 * vendor or secret. The endpoint is chosen by model FAMILY, because the two
 * families speak different shapes:
 *   - `imagen-*`  → `:predict` (returns `predictions[].bytesBase64Encoded`)
 *   - everything else (`gemini-*-image`) → `:generateContent` (returns an
 *     inline-image part). Imagen `:predict` is gated to existing users, so the
 *     default (`IMAGE_MODEL`) is a Gemini flash-image model.
 * Holds no sport logic; the prompt arrives finished.
 */
export class GeminiImageProvider implements IImageProvider {
  readonly id = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    apiKey: string = env.GEMINI_API_KEY,
    model: string = env.IMAGE_MODEL,
  ) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.trim().length > 0;
  }

  async generate(input: ImageGenInput): Promise<ImageGenOutput> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'GeminiImageProvider unavailable: GEMINI_API_KEY is not configured.',
      );
    }

    const isImagen = this.model.startsWith('imagen');
    const result = isImagen
      ? await this.generateImagen(input.prompt)
      : await this.generateGemini(input.prompt);
    logCost('gemini:image', IMAGE_COST_PER_CALL);
    return result;
  }

  // Imagen family — `:predict`.
  private async generateImagen(prompt: string): Promise<ImageGenOutput> {
    const url = `${GEMINI_BASE}/${this.model}:predict?key=${encodeURIComponent(
      this.apiKey,
    )}`;
    const response = await this.post(url, {
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1' },
    });
    const data = (await response.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const prediction = data.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      throw new Error('Imagen returned no image data.');
    }
    return {
      bytes: base64ToBytes(prediction.bytesBase64Encoded),
      contentType: prediction.mimeType ?? 'image/png',
    };
  }

  // Gemini multimodal image family — `:generateContent`, inline-image part.
  private async generateGemini(prompt: string): Promise<ImageGenOutput> {
    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;
    const response = await this.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    const data = (await response.json()) as GeminiImageResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      throw new Error('Gemini returned no inline image data.');
    }
    return {
      bytes: base64ToBytes(inline.data),
      contentType: inline.mimeType ?? 'image/png',
    };
  }

  private async post(url: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error('GeminiImageProvider network error', err);
      throw new Error('Image request failed: network error.');
    }
    if (!response.ok) {
      throw new Error(
        `Image request failed: ${response.status} ${await safeText(response)}`,
      );
    }
    return response;
  }
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
  }>;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}

// Pure base64 -> bytes. Avoids `atob`/`Buffer`, neither of which is guaranteed
// across Hermes, Node, and Deno.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((len * 3) / 4) - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64.indexOf(clean[i]!);
    const c1 = B64.indexOf(clean[i + 1]!);
    const c2 = clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0;
    const c3 = clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0;
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}
