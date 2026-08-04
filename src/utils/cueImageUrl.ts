import { env } from '@/config/env';

/**
 * Public URL for a cue image, derived from its reuse key alone (ADR 0012).
 * The object name IS `<reuseKey>.png` in the public `cue-images` bucket, so
 * the client needs no catalog round-trip — a session's `cueImageKey` is enough
 * to render its image. Returns null when there is no key.
 */
export function cueImageUrlForKey(
  reuseKey: string | null | undefined,
): string | null {
  if (!reuseKey) return null;
  return `${env.SUPABASE_URL}/storage/v1/object/public/cue-images/${reuseKey}.png`;
}
