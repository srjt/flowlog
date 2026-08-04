import { env } from '@/config/env';
import { GeminiImageProvider } from '@/providers/image/GeminiImageProvider';
import type { IImageProvider } from '@/providers/image/IImageProvider';

/**
 * Image provider selector, chosen by `IMAGE_PROVIDER` (ADR 0012). Default
 * `gemini` (Imagen 4 Fast). Cue images are best-effort: when the selected
 * provider is unconfigured, `isAvailable()` returns false and the pipeline
 * simply skips the image — no error. To add one: implement `IImageProvider`,
 * add it to this map, set the env var.
 */
type ProviderFactory = () => IImageProvider;

const providers: Record<string, ProviderFactory> = {
  gemini: () => new GeminiImageProvider(),
};

function selectProvider(): IImageProvider {
  const factory = providers[env.IMAGE_PROVIDER];
  if (!factory) {
    throw new Error(
      `Unknown IMAGE_PROVIDER "${env.IMAGE_PROVIDER}". ` +
        `Available: ${Object.keys(providers).join(', ')}.`,
    );
  }
  return factory();
}

export const imageProvider: IImageProvider = selectProvider();

export type {
  IImageProvider,
  ImageGenInput,
  ImageGenOutput,
} from '@/providers/image/IImageProvider';
