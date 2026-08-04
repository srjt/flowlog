/**
 * Shared cue-image catalog store (ADR 0012). Separate from `IStorageProvider`
 * because it is a fundamentally different concern: the catalog is NOT
 * user-scoped — one image is written once and read by every user whose cue
 * resolves to the same reuse key. Writes happen server-side (service role);
 * the client-side implementation exists for the reference pipeline + tests.
 */
export interface CueImageRecord {
  reuseKey: string;
  sportKey: string;
  targetPosition: string | null;
  prompt: string | null;
  /** Object path within the `cue-images` bucket (always `<reuseKey>.png`). */
  storagePath: string;
  provider: string | null;
}

export interface NewCueImage {
  reuseKey: string;
  sportKey: string;
  targetPosition: string | null;
  prompt: string;
  provider: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ICueImageStore {
  /** Look up a catalog entry by reuse key, or null on a miss. */
  findCueImage(reuseKey: string): Promise<CueImageRecord | null>;
  /** Upload the image and index it in the catalog; returns the stored record. */
  saveCueImage(input: NewCueImage): Promise<CueImageRecord>;
}

/** The object path (and public-URL suffix) for a reuse key. Single-sourced. */
export function cueImageStoragePath(reuseKey: string): string {
  return `${reuseKey}.png`;
}
