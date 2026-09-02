import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Route params are per-test so one screen can be driven in both modes.
let mockParams: { mode?: string } = {};

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/utils/featureTour', () => ({
  hasSeenFeatureTour: jest.fn(async () => false),
  markFeatureTourSeen: jest.fn(async () => undefined),
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import { router } from 'expo-router';
// eslint-disable-next-line import/first
import { markFeatureTourSeen } from '@/utils/featureTour';
// eslint-disable-next-line import/first
import FeatureTour from '../../app/(onboarding)/tour';

describe('FeatureTour screen', () => {
  beforeEach(() => {
    mockParams = {};
  });
  afterEach(() => jest.clearAllMocks());

  it('leads with the core promise and covers all four tabs', () => {
    const { getByTestId, getByText } = render(<FeatureTour />);

    // The hero line is the whole point of the tour, so it is asserted verbatim.
    expect(
      getByText(
        /Talk for 60 seconds after training\. Flowlog gives you one specific thing to work on\./,
      ),
    ).toBeTruthy();
    ['Record', 'Log', 'Trends', 'Profile'].forEach((tab) => {
      expect(getByText(tab)).toBeTruthy();
    });
    expect(getByTestId('tour-dots').props.accessibilityLabel).toBe(
      'Slide 1 of 4',
    );
  });

  it('Skip marks the tour seen and drops a first-run user on Record', async () => {
    const { getByTestId } = render(<FeatureTour />);

    await act(async () => {
      fireEvent.press(getByTestId('tour-skip'));
    });

    // Skipping counts as done -- it must not reappear on the next launch.
    expect(markFeatureTourSeen).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/record');
  });

  it('Next walks to the last slide, where finishing opens Record', async () => {
    const { getByTestId } = render(<FeatureTour />);

    fireEvent.press(getByTestId('tour-next'));
    fireEvent.press(getByTestId('tour-next'));
    fireEvent.press(getByTestId('tour-next'));

    // Position is announced, and the CTA switches to the finish action.
    expect(getByTestId('tour-dots').props.accessibilityLabel).toBe(
      'Slide 4 of 4',
    );
    expect(getByTestId('tour-next')).toHaveTextContent('Start reflecting');
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId('tour-next'));
    });

    expect(markFeatureTourSeen).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/record');
  });

  it('a swipe moves the position indicator without any button press', () => {
    const { getByTestId } = render(<FeatureTour />);

    fireEvent(getByTestId('tour-pager'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 750 * 2 } },
    });

    expect(getByTestId('tour-dots').props.accessibilityLabel).toBe(
      'Slide 3 of 4',
    );
  });

  describe('replay mode', () => {
    beforeEach(() => {
      mockParams = { mode: 'replay' };
    });

    it('finishing returns to Profile rather than hijacking to Record', async () => {
      const { getByTestId } = render(<FeatureTour />);

      fireEvent.press(getByTestId('tour-next'));
      fireEvent.press(getByTestId('tour-next'));
      fireEvent.press(getByTestId('tour-next'));
      await act(async () => {
        fireEvent.press(getByTestId('tour-next'));
      });

      expect(router.replace).toHaveBeenCalledWith('/(tabs)/profile');
    });

    it('Skip also returns to Profile', async () => {
      const { getByTestId } = render(<FeatureTour />);

      await act(async () => {
        fireEvent.press(getByTestId('tour-skip'));
      });

      expect(router.replace).toHaveBeenCalledWith('/(tabs)/profile');
    });
  });
});

// The flag is the seam that guarantees "shows once, survives a restart"; the
// trigger glue at the entry gate and welcome completion rides on it.
describe('feature-tour one-time flag', () => {
  const featureTour = jest.requireActual('@/utils/featureTour');

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('is idempotent: stays seen after marking, so it never replays', async () => {
    expect(await featureTour.hasSeenFeatureTour()).toBe(false);
    await featureTour.markFeatureTourSeen();
    expect(await featureTour.hasSeenFeatureTour()).toBe(true);
    // A second mark is a no-op, not a reset.
    await featureTour.markFeatureTourSeen();
    expect(await featureTour.hasSeenFeatureTour()).toBe(true);
  });

  it('degrades to "not seen" when storage fails instead of throwing', async () => {
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await featureTour.hasSeenFeatureTour()).toBe(false);

    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(featureTour.markFeatureTourSeen()).resolves.toBeUndefined();
  });
});
