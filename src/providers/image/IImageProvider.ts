/**
 * Image provider contract (ADR 0012). One responsibility: turn a finished,
 * sport-aware prompt into image bytes. Holds NO sport logic and NO caching —
 * the prompt is built by `buildCueImagePrompt` and the cache-first flow lives
 * in `CueImageService`. Swappable via env (`IMAGE_PROVIDER`), mirroring
 * `IAIProvider`.
 */
export interface ImageGenInput {
  /** The finished prompt (house style + sport subject already applied). */
  prompt: string;
}

export interface ImageGenOutput {
  /** Raw encoded image bytes. */
  bytes: Uint8Array;
  /** MIME type of `bytes`, e.g. `image/png`. */
  contentType: string;
}

export interface IImageProvider {
  /** Human-readable id persisted for provenance (e.g. `gemini`). */
  readonly id: string;
  generate(input: ImageGenInput): Promise<ImageGenOutput>;
  /** False when the provider is unconfigured — the caller skips generation. */
  isAvailable(): Promise<boolean>;
}
