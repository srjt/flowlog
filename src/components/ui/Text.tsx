import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'title' | 'heading' | 'body' | 'caption' | 'cue';

const VARIANT_CLASS: Record<Variant, string> = {
  title: 'text-3xl font-bold text-white',
  heading: 'text-xl font-semibold text-white',
  body: 'text-base text-white',
  caption: 'text-sm text-muted',
  cue: 'text-2xl font-semibold text-accent leading-8',
};

// Tailwind's `text-*` font sizes (incl. arbitrary lengths), the `text-*`
// utilities that set neither size nor color, and the `font-*` weights.
const TEXT_SIZE = /^(xs|sm|base|lg|[2-9]?xl|\[\d.*\])$/;
const TEXT_NOT_COLOR =
  /^(left|center|right|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty|opacity-.*)$/;
const FONT_WEIGHT =
  /^(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;

type Slot = 'size' | 'weight' | 'color' | 'leading';

/**
 * The style property an unconditional utility sets, or null. Classes with a
 * modifier (`dark:`, `active:`, …) only apply sometimes, so they never displace
 * a variant default.
 */
function slotOf(cls: string): Slot | null {
  if (cls.startsWith('leading-')) return 'leading';
  if (cls.startsWith('font-')) {
    return FONT_WEIGHT.test(cls.slice(5)) ? 'weight' : null;
  }
  if (!cls.startsWith('text-')) return null;
  const value = cls.slice(5);
  if (TEXT_SIZE.test(value)) return 'size';
  return TEXT_NOT_COLOR.test(value) ? null : 'color';
}

/**
 * NativeWind resolves two utilities for the same property by stylesheet order,
 * not by their order in `className` — on web and native alike. Tailwind emits
 * colors alphabetically, so a caption's `text-muted` beat a caller's
 * `text-danger`. Drop each variant default the caller sets itself.
 */
function variantClassName(variant: Variant, className: string): string {
  const overridden = new Set(className.split(/\s+/).map(slotOf));
  const defaults = VARIANT_CLASS[variant].split(' ').filter((cls) => {
    const slot = slotOf(cls);
    return slot === null || !overridden.has(slot);
  });
  return [...defaults, className].join(' ').trim();
}

export interface AppTextProps extends TextProps {
  variant?: Variant;
  className?: string;
}

/**
 * Themed text primitive. Use instead of raw <Text> for consistent styling.
 * A size, weight, color or leading in `className` replaces the variant's own.
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
      className={variantClassName(variant, className)}
      {...props}
    />
  );
}
