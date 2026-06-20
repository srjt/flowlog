import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'title' | 'heading' | 'body' | 'caption' | 'cue';

const VARIANT_CLASS: Record<Variant, string> = {
  title: 'text-3xl font-bold text-white',
  heading: 'text-xl font-semibold text-white',
  body: 'text-base text-white',
  caption: 'text-sm text-muted',
  cue: 'text-2xl font-semibold text-accent leading-8',
};

export interface AppTextProps extends TextProps {
  variant?: Variant;
  className?: string;
}

/**
 * Themed text primitive. Use instead of raw <Text> for consistent styling.
 *
 * Accessibility: OS Dynamic Type is respected — `allowFontScaling` defaults to
 * true (never force it off) and callers may pass a `maxFontSizeMultiplier` where
 * a layout needs a ceiling. Both are overridable via props.
 */
export function Text({
  variant = 'body',
  className = '',
  allowFontScaling = true,
  ...props
}: AppTextProps) {
  return (
    <RNText
      allowFontScaling={allowFontScaling}
      className={`${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
