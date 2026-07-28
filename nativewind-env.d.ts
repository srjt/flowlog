/// <reference types="nativewind/types" />

// NativeWind v4 ships its `className` typing via `react-native-css-interop`,
// but installs it as a NESTED dependency, so the `nativewind/types` reference
// above cannot resolve the augmentation in a strict tsconfig. We declare it
// explicitly here so `className` (and NativeWind's container variants) are
// typed on the React Native components we use. Safe and version-proof.

import 'react-native';
import 'react-native-safe-area-context';

declare module 'react-native' {
  interface ViewProps {
    className?: string;
  }
  interface TextProps {
    className?: string;
  }
  interface ImageProps {
    className?: string;
  }
  interface TextInputProps {
    className?: string;
  }
  interface PressableProps {
    className?: string;
  }
  interface SwitchProps {
    className?: string;
  }
  interface ScrollViewProps {
    className?: string;
    contentContainerClassName?: string;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- generic param name must match RN's FlatListProps<ItemT> for declaration merging
  interface FlatListProps<ItemT> {
    className?: string;
    contentContainerClassName?: string;
  }
}

declare module 'react-native-safe-area-context' {
  interface NativeSafeAreaViewProps {
    className?: string;
  }
}
