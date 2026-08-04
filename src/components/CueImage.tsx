import { useState } from 'react';
import { Image, View } from 'react-native';

import { Skeleton } from '@/components/ui';

export interface CueImageProps {
  /** Public cue-image URL, or null/undefined when there is none. */
  url: string | null | undefined;
  /** The cue text — used as the image's accessibility label. */
  cue: string;
  /** `full` = square hero image; `thumb` = small square for list rows. */
  variant?: 'full' | 'thumb';
}

/**
 * Renders the generated cue image (ADR 0012) with a loading placeholder and a
 * graceful absence: nothing is shown when there is no URL (older sessions, or a
 * best-effort miss) or if the image fails to load — the cue text always stands
 * on its own. The image is decorative-but-informative, so its accessibility
 * label repeats the cue rather than leaving it unlabeled.
 */
export function CueImage({ url, cue, variant = 'full' }: CueImageProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  if (!url || state === 'error') return null;

  const box = variant === 'thumb' ? 'h-14 w-14' : 'aspect-square w-full';

  return (
    <View className={`overflow-hidden rounded-xl bg-surface ${box}`}>
      {state === 'loading' ? (
        <Skeleton className="absolute inset-0 h-full w-full" />
      ) : null}
      <Image
        source={{ uri: url }}
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
        resizeMode="cover"
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Illustration of the coaching cue: ${cue}`}
        className="h-full w-full"
      />
    </View>
  );
}
