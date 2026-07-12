import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { useSessionStore } from '@/store/sessionStore';

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

  it('auto-stops at the max duration and says why', () => {
    const { getByTestId, getByText } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle'))); // start
    act(() => jest.advanceTimersByTime(90_000)); // hit the 90s ceiling

    // Landed in review (not still recording), with the explanation visible.
    expect(getByText('Submit')).toBeTruthy();
    expect(getByText(/max length reached/i)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('submitReview stamps a fresh idempotency key and clears the upload path', () => {
    useSessionStore.setState({
      clientSessionId: 'stale-key',
      uploadedAudioPath: 'u1/stale.m4a',
    });
    const { getByTestId } = render(<RecordScreen />);
    act(() => fireEvent.press(getByTestId('record-toggle')));
    act(() => jest.advanceTimersByTime(20000));
    act(() => fireEvent.press(getByTestId('record-toggle'))); // → review
    act(() => fireEvent.press(getByTestId('review-submit')));

    const { clientSessionId, uploadedAudioPath } = useSessionStore.getState();
    expect(clientSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(clientSessionId).not.toBe('stale-key');
    expect(uploadedAudioPath).toBeNull();
  });

  describe('backgrounding mid-recording', () => {
    const getBackgroundHandler = (
      spy: jest.SpyInstance,
    ): ((state: string) => void) => {
      const call = spy.mock.calls.at(-1);
      expect(call?.[0]).toBe('change');
      return call?.[1] as (state: string) => void;
    };

    it('lands a valid partial take in review with an explanation', () => {
      const spy = jest.spyOn(AppState, 'addEventListener');
      const { getByTestId, getByText } = render(<RecordScreen />);
      act(() => fireEvent.press(getByTestId('record-toggle'))); // start
      act(() => jest.advanceTimersByTime(25_000)); // ≥ 20s min

      const handler = getBackgroundHandler(spy);
      act(() => handler('background'));

      expect(getByText('Submit')).toBeTruthy();
      expect(getByText(/stopped when you left/i)).toBeTruthy();
      expect(router.push).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('discards an under-minimum take back to idle with an explanation', () => {
      const spy = jest.spyOn(AppState, 'addEventListener');
      const { getByTestId, getByText, queryByText } = render(<RecordScreen />);
      act(() => fireEvent.press(getByTestId('record-toggle'))); // start
      act(() => jest.advanceTimersByTime(5_000)); // < 20s min

      const handler = getBackgroundHandler(spy);
      act(() => handler('background'));

      expect(getByText('Record')).toBeTruthy(); // idle again
      expect(queryByText('Keep recording')).toBeNull(); // no false resume offer
      expect(getByText(/under the 20s minimum/i)).toBeTruthy();
      spy.mockRestore();
    });

    it("ignores 'inactive' (banners, control center) — the take keeps going", () => {
      const spy = jest.spyOn(AppState, 'addEventListener');
      const { getByTestId, queryByText } = render(<RecordScreen />);
      act(() => fireEvent.press(getByTestId('record-toggle'))); // start
      act(() => jest.advanceTimersByTime(25_000));

      const handler = getBackgroundHandler(spy);
      act(() => handler('inactive'));

      expect(queryByText('Submit')).toBeNull(); // still recording, no review
      spy.mockRestore();
    });
  });
});
