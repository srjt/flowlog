import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

// Demo mode keeps begin/finish synchronous (no real microphone).
jest.mock('@/config/featureFlags', () => ({
  isDemoMode: true,
  isLocalPipeline: false,
}));
jest.mock('expo-av', () => ({ Audio: {} }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/hooks/useSessionTrends', () => ({
  useSessionTrends: () => ({ trends: null, loading: false }),
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import RecordScreen from '../../app/(tabs)/record';

describe('RecordScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not submit a too-short recording; offers keep / discard', () => {
    const { getByTestId, getByText } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle'))); // start
    act(() => jest.advanceTimersByTime(3000)); // 3s — below 20s min
    act(() => fireEvent.press(getByTestId('record-toggle'))); // stop too early

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Keep recording')).toBeTruthy();
    expect(getByText('Discard')).toBeTruthy();
    expect(getByText(/at least 20s/i)).toBeTruthy();
  });

  it('a valid take goes to review and only Submit starts processing', () => {
    const { getByTestId, getByText } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle'))); // start
    act(() => jest.advanceTimersByTime(20000)); // 20s — valid
    act(() => fireEvent.press(getByTestId('record-toggle'))); // stop → review

    // Review step, not yet processing.
    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Submit')).toBeTruthy();
    expect(getByText('Re-record')).toBeTruthy();

    act(() => fireEvent.press(getByTestId('review-submit')));
    expect(router.push).toHaveBeenCalledWith('/(flow)/processing');
  });

  it('cancel during recording returns to idle with no pipeline call', () => {
    const { getByTestId, getByText, queryByText } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle'))); // start
    act(() => jest.advanceTimersByTime(5000));
    act(() => fireEvent.press(getByTestId('record-cancel'))); // cancel

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Record')).toBeTruthy(); // back to idle
    expect(queryByText('Submit')).toBeNull();
    expect(queryByText('Keep recording')).toBeNull();
  });

  it('re-record from review starts a fresh capture', async () => {
    const { getByTestId, queryByText } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle'))); // start
    act(() => jest.advanceTimersByTime(20000)); // valid
    act(() => fireEvent.press(getByTestId('record-toggle'))); // → review

    expect(getByTestId('review-rerecord')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('review-rerecord')); // re-record
    });

    // Back to a live recording; review is gone and nothing was submitted.
    expect(queryByText('Submit')).toBeNull();
    expect(getByTestId('record-toggle')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});
