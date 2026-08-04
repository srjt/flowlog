import type { IImageProvider } from '@/providers/image';
import { imageProvider } from '@/providers/image';
import type {
  CueImageRecord,
  ICueImageStore,
} from '@/providers/storage/ICueImageStore';
import { cueImageStore } from '@/providers/storage/SupabaseCueImageStore';
import type { ISportContext } from '@/sports/ISportContext';
import { deriveCueImageKey } from '@/utils/cueImageKey';
import { buildCueImagePrompt } from '@/utils/cueImagePrompt';
import { logger } from '@/utils/logger';

export interface CueImageInput {
  cue: string;
  targetPosition: string | null;
  sportContext: ISportContext;
}

export interface CueImageResult {
  reuseKey: string;
  storagePath: string;
  /** True when an existing catalog entry was reused (no generation). */
  cached: boolean;
}

/**
 * Cache-first cue-image engine (ADR 0012). Derives the cross-user reuse key,
 * checks the shared catalog, and only generates + stores on a miss — so the
 * same mechanical cue is drawn once and reused by everyone.
 *
 * Returns null when the provider is unconfigured (feature effectively off).
 * Generation/storage errors PROPAGATE — the caller (pipeline) wraps this in a
 * best-effort guard so an image failure never fails the session.
 */
export class CueImageService {
  constructor(
    private readonly provider: IImageProvider = imageProvider,
    private readonly store: ICueImageStore = cueImageStore,
  ) {}

  async ensureCueImage(input: CueImageInput): Promise<CueImageResult | null> {
    if (!input.cue.trim()) return null;
    if (!(await this.provider.isAvailable())) {
      logger.debug('cue image skipped: provider unavailable');
      return null;
    }

    const reuseKey = deriveCueImageKey({
      sportKey: input.sportContext.sportKey,
      targetPosition: input.targetPosition,
      cue: input.cue,
    });

    const hit = await this.store.findCueImage(reuseKey);
    if (hit) {
      logger.debug('cue image cache hit', { reuseKey });
      return { reuseKey, storagePath: hit.storagePath, cached: true };
    }

    const prompt = buildCueImagePrompt({
      cue: input.cue,
      targetPosition: input.targetPosition,
      styleHint: input.sportContext.imageStyleHint,
    });
    const image = await this.provider.generate({ prompt });

    const saved: CueImageRecord = await this.store.saveCueImage({
      reuseKey,
      sportKey: input.sportContext.sportKey,
      targetPosition: input.targetPosition,
      prompt,
      provider: this.provider.id,
      bytes: image.bytes,
      contentType: image.contentType,
    });
    logger.debug('cue image generated', {
      reuseKey,
      provider: this.provider.id,
    });

    return { reuseKey, storagePath: saved.storagePath, cached: false };
  }
}
