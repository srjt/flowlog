import { fireEvent, render } from '@testing-library/react-native';

import { StreakStrip } from '@/components/StreakStrip';
import type { SportTrends } from '@/services/TrendsService';

function trends(overrides: Partial<SportTrends> = {}): SportTrends {
  return {
    sessionCount: 5,
    streakDays: 3,
    lastSessionAt: '2026-06-10T10:00:00.000Z',
    focusArea: 'Half guard',
    topPositions: [],
    recentMistakes: [],
    moodBreakdown: [],
    thumbsUpRate: null,
    ...overrides,
  };
}

describe('StreakStrip', () => {
  it('is a labelled button that fires onPress when populated', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <StreakStrip trends={trends()} loading={false} onPress={onPress} />,
    );
    const strip = getByTestId('streak-strip');
    expect(strip.props.accessibilityRole).toBe('button');
    expect(strip.props.accessibilityLabel).toBe('View your session log');

    fireEvent.press(strip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a non-interactive card when no onPress is given', () => {
    const { getByTestId } = render(
      <StreakStrip trends={trends()} loading={false} />,
    );
    const strip = getByTestId('streak-strip');
    expect(strip.props.accessibilityRole).toBeUndefined();
    expect(strip.props.onPress).toBeUndefined();
  });

  it('shows the zero-session prompt (never interactive) for brand-new users', () => {
    const onPress = jest.fn();
    const { queryByTestId, getByText } = render(
      <StreakStrip
        trends={trends({ sessionCount: 0 })}
        loading={false}
        onPress={onPress}
      />,
    );
    expect(queryByTestId('streak-strip')).toBeNull();
    expect(getByText(/record your first reflection/i)).toBeTruthy();
  });

  it('shows a skeleton while loading', () => {
    const { getByTestId, queryByTestId } = render(
      <StreakStrip trends={null} loading onPress={jest.fn()} />,
    );
    expect(
      getByTestId('streak-skeleton', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(queryByTestId('streak-strip')).toBeNull();
  });
});
