import { env } from '@/config/env';
import type {
  IImageProvider,
  ImageGenInput,
  ImageGenOutput,
} from '@/providers/image/IImageProvider';
import { logCost } from '@/utils/cost';
import { logger } from '@/utils/logger';

const IMAGEN_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Imagen 4 Fast — cheapest first-party option, ~$0.02/image (ADR 0012).
const IMAGE_COST_PER_CALL = 0.02;

/**
 * Google Imagen image provider via the Gemini API (ADR 0012). Reuses
 * `GEMINI_API_KEY` — the production pipeline already runs on Gemini, so no new
 * vendor or secret. Calls the `:predict` endpoint (Imagen's shape) and returns
 * the decoded bytes. Holds no sport logic; the prompt arrives finished.
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

    const url = `${IMAGEN_BASE}/${this.model}:predict?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: input.prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
      });
    } catch (err) {
      logger.error('GeminiImageProvider network error', err);
      throw new Error('Imagen request failed: network error.');
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(`Imagen request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as ImagenResponse;
    const prediction = data.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      throw new Error('Imagen returned no image data.');
    }
    logCost('gemini:image', IMAGE_COST_PER_CALL);

    return {
      bytes: base64ToBytes(prediction.bytesBase64Encoded),
      contentType: prediction.mimeType ?? 'image/png',
    };
  }
}

interface ImagenResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
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
