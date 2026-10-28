import { render } from '@testing-library/react-native';
import postcss from 'postcss';
import type { ReactElement } from 'react';
import { Text as RNText } from 'react-native';
import {
  createMockComponent,
  registerCSS,
  render as renderStyled,
} from 'react-native-css-interop/test';
import tailwind from 'tailwindcss';

import { Text } from '@/components/ui/Text';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindConfig = require('../../tailwind.config.js');

const VARIANTS = ['title', 'heading', 'body', 'caption', 'cue'] as const;
const COLORS: Record<string, string> = {
  ...tailwindConfig.theme.extend.colors,
  white: '#FFFFFF',
};

function rgba(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 1)`;
}

function classNameOf(element: ReactElement): string {
  return render(element).getByTestId('t').props.className;
}

/**
 * Resolve a className the way the app does on device: the project's Tailwind
 * config compiled through NativeWind's native style runtime. Jest's Babel
 * config skips NativeWind's JSX transform, so `Text` itself renders an
 * un-styled className; this renders that same className through it.
 */
let css = '';
beforeAll(async () => {
  const content = VARIANTS.map((v) =>
    classNameOf(<Text testID="t" variant={v} />),
  ).concat(Object.keys(COLORS).map((c) => `text-${c}`));
  ({ css } = await postcss([
    tailwind({ ...tailwindConfig, content: [{ raw: content.join(' ') }] }),
  ]).process('@tailwind utilities;', { from: undefined }));
});

// The mock's return type drops the wrapped component's props.
const StyledText = createMockComponent(RNText, {
  className: 'style',
}) as unknown as typeof RNText;

function resolvedStyle(className: string) {
  registerCSS(css);
  return renderStyled(
    <StyledText testID="s" className={className} />,
  ).getByTestId('s').props.style;
}

describe('Text', () => {
  describe('a color in className beats the variant color', () => {
    for (const variant of VARIANTS) {
      it.each(Object.keys(COLORS))(`${variant} + text-%s`, (color) => {
        const className = classNameOf(
          <Text testID="t" variant={variant} className={`text-${color}`} />,
        );
        expect(resolvedStyle(className).color).toBe(rgba(COLORS[color]!));
      });
    }
  });

  it('keeps the variant size when only the color is overridden', () => {
    const plain = classNameOf(<Text testID="t" variant="caption" />);
    const danger = classNameOf(
      <Text testID="t" variant="caption" className="text-danger" />,
    );
    expect(resolvedStyle(danger).fontSize).toBe(resolvedStyle(plain).fontSize);
  });

  it('drops only the variant default the caller replaces', () => {
    expect(
      classNameOf(<Text testID="t" variant="title" className="text-base" />),
    ).toBe('font-bold text-white text-base');
    expect(
      classNameOf(
        <Text testID="t" variant="caption" className="text-center mt-2" />,
      ),
    ).toBe('text-sm text-muted text-center mt-2');
  });

  it('keeps the variant default when the override is conditional', () => {
    expect(
      classNameOf(
        <Text testID="t" variant="caption" className="active:text-white" />,
      ),
    ).toBe('text-sm text-muted active:text-white');
  });

  it('renders the variant classes alone without a className', () => {
    expect(classNameOf(<Text testID="t" variant="cue" />)).toBe(
      'text-2xl font-semibold text-accent leading-8',
    );
  });
});
