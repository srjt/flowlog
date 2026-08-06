// Cue-image generation — server-side runtime (Deno edge). Mirrors the src/
// reference (`src/providers/image/*` + `src/services/CueImageService.ts`),
// ADR 0012. Single-sources the reuse key and prompt builder from src/ so they
// cannot drift; the provider + store logic is mirrored here against raw fetch
// (no remote imports), same as `_shared/ai.ts`.

import { deriveCueImageKey } from '../../../src/utils/cueImageKey.ts';
import { buildCueImagePrompt } from '../../../src/utils/cueImagePrompt.ts';
import { dbSelect, dbUpsert, uploadObject } from './supabaseRest.ts';
import type { ServerSportContext } from './sports.ts';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CUE_IMAGE_BUCKET = 'cue-images';
const IMAGE_PROVIDER_ID = 'gemini';

const apiKey = () => Deno.env.get('GEMINI_API_KEY') ?? '';
const model = () => Deno.env.get('IMAGE_MODEL') ?? 'gemini-2.5-flash-image';

/** Object path (and public-URL suffix) for a reuse key — matches the client. */
export function cueImageStoragePath(reuseKey: string): string {
  return `${reuseKey}.png`;
}

/** Public URL the client renders. The `cue-images` bucket is public read. */
export function cueImageUrlFromKey(reuseKey: string | null): string | null {
  if (!reuseKey) return null;
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  return `${base}/storage/v1/object/public/${CUE_IMAGE_BUCKET}/${cueImageStoragePath(reuseKey)}`;
}

/**
 * Cache-first: derive the reuse key, reuse a catalog hit, otherwise generate +
 * store + index. Returns the reuse key, or null when generation is disabled
 * (no GEMINI_API_KEY) or the cue is empty. Errors PROPAGATE — the caller wraps
 * this best-effort so an image failure never fails the session.
 */
export async function ensureCueImage(
  cue: string,
  targetPosition: string,
  sport: ServerSportContext,
): Promise<string | null> {
  if (!cue.trim() || !apiKey().trim()) return null;

  const reuseKey = deriveCueImageKey({
    sportKey: sport.sportKey,
    targetPosition,
    cue,
  });

  // Cache hit — reuse across users.
  const existing = await dbSelect(
    `cue_images?select=reuse_key&reuse_key=eq.${reuseKey}&limit=1`,
  );
  if (existing?.[0]) return reuseKey;

  const prompt = buildCueImagePrompt({
    cue,
    targetPosition,
    styleHint: sport.imageStyleHint,
  });
  const image = await generate(prompt);

  await uploadObject(
    CUE_IMAGE_BUCKET,
    cueImageStoragePath(reuseKey),
    image.bytes,
    image.contentType,
  );
  await dbUpsert('cue_images', {
    reuse_key: reuseKey,
    sport_key: sport.sportKey,
    target_position: targetPosition || null,
    prompt,
    storage_path: cueImageStoragePath(reuseKey),
    provider: IMAGE_PROVIDER_ID,
  });

  return reuseKey;
}

// Endpoint chosen by model family (see the src reference): `imagen-*` uses
// `:predict`; Gemini `*-image` models use `:generateContent` (inline image).
async function generate(
  prompt: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return model().startsWith('imagen')
    ? await generateImagen(prompt)
    : await generateGemini(prompt);
}

async function generateImagen(
  prompt: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = `${GEMINI_BASE}/${model()}:predict?key=${encodeURIComponent(
    apiKey(),
  )}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1' },
    }),
  });
  if (!res.ok) {
    throw new Error(`Imagen request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
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

async function generateGemini(
  prompt: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = `${GEMINI_BASE}/${model()}:generateContent?key=${encodeURIComponent(
    apiKey(),
  )}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini image failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
      };
    }>;
  };
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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
