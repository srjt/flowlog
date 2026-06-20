import { render } from '@testing-library/react-native';

import { FirstResultCelebration } from '@/components/FirstResultCelebration';
import {
  hasCelebratedFirstResult,
  markFirstResultCelebrated,
} from '@/utils/firstResult';

describe('FirstResultCelebration', () => {
  it('shows a distinct celebration on the first result', () => {
    const { getByTestId, getByText } = render(
      <FirstResultCelebration sessionCount={1} celebrate />,
    );
    expect(getByTestId('first-result-celebration')).toBeTruthy();
    expect(getByText(/First reflection logged/i)).toBeTruthy();
  });

  it('shows lightweight progress on later results', () => {
    const { getByTestId, getByText } = render(
      <FirstResultCelebration sessionCount={4} celebrate={false} />,
    );
    expect(getByTestId('result-progress')).toBeTruthy();
    expect(getByText(/Session 4 of 10/i)).toBeTruthy();
  });

  it('announces the unlock once reached', () => {
    const { getByText } = render(
      <FirstResultCelebration sessionCount={10} celebrate={false} />,
    );
    expect(getByText(/Trends unlocked/i)).toBeTruthy();
  });

  it('renders nothing before any sessions exist', () => {
    const { queryByTestId } = render(
      <FirstResultCelebration sessionCount={0} celebrate={false} />,
    );
    expect(queryByTestId('result-progress')).toBeNull();
    expect(queryByTestId('first-result-celebration')).toBeNull();
  });
});

describe('first-result one-time flag', () => {
  it('is idempotent: stays celebrated after marking, so it never replays', async () => {
    expect(await hasCelebratedFirstResult()).toBe(false);
    await markFirstResultCelebrated();
    expect(await hasCelebratedFirstResult()).toBe(true);
  });
});
