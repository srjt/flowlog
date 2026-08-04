import { supabase } from '@/lib/supabase';
import type {
  CueImageRecord,
  ICueImageStore,
  NewCueImage,
} from '@/providers/storage/ICueImageStore';
import { cueImageStoragePath } from '@/providers/storage/ICueImageStore';
import { logger } from '@/utils/logger';

const CUE_IMAGE_BUCKET = 'cue-images';

/**
 * Reference `ICueImageStore` on Supabase (ADR 0012). Reads work with the anon
 * key; WRITES require the service role, so the client cannot populate the
 * shared catalog — that happens in the `process-session` edge function. This
 * class is the unit-test reference and the local-pipeline fallback.
 */
export class SupabaseCueImageStore implements ICueImageStore {
  async findCueImage(reuseKey: string): Promise<CueImageRecord | null> {
    const { data, error } = await supabase
      .from('cue_images')
      .select('*')
      .eq('reuse_key', reuseKey)
      .maybeSingle();

    if (error) {
      logger.warn('SupabaseCueImageStore.findCueImage failed', error);
      return null;
    }
    return data ? mapRow(data) : null;
  }

  async saveCueImage(input: NewCueImage): Promise<CueImageRecord> {
    const storagePath = cueImageStoragePath(input.reuseKey);

    const { error: uploadError } = await supabase.storage
      .from(CUE_IMAGE_BUCKET)
      .upload(storagePath, input.bytes as unknown as ArrayBuffer, {
        contentType: input.contentType,
        upsert: true,
      });
    if (uploadError) {
      throw new Error(`Cue image upload failed: ${uploadError.message}`);
    }

    const row = {
      reuse_key: input.reuseKey,
      sport_key: input.sportKey,
      target_position: input.targetPosition,
      prompt: input.prompt,
      storage_path: storagePath,
      provider: input.provider,
    };
    const { error: insertError } = await supabase
      .from('cue_images')
      .upsert(row, { onConflict: 'reuse_key' });
    if (insertError) {
      throw new Error(`Cue image index failed: ${insertError.message}`);
    }

    return {
      reuseKey: input.reuseKey,
      sportKey: input.sportKey,
      targetPosition: input.targetPosition,
      prompt: input.prompt,
      storagePath,
      provider: input.provider,
    };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): CueImageRecord {
  return {
    reuseKey: row.reuse_key,
    sportKey: row.sport_key,
    targetPosition: row.target_position ?? null,
    prompt: row.prompt ?? null,
    storagePath: row.storage_path,
    provider: row.provider ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const cueImageStore: ICueImageStore = new SupabaseCueImageStore();
