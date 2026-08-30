import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

// Production path: onboarding actually persists and gates on auth.
jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: false,
  featureFlags: { golfSport: false },
}));
jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));
jest.mock('@/services/AuthService', () => ({
  authService: { completeOnboarding: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import { authService } from '@/services/AuthService';
// eslint-disable-next-line import/first
import { useUserStore } from '@/store/userStore';
// eslint-disable-next-line import/first
import Welcome from '../../app/(onboarding)/welcome';

describe('Onboarding flow', () => {
  beforeEach(() => {
    useUserStore.setState({
      authUser: { id: 'u1', email: 'a@b.com' },
      onboardingComplete: false,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('walks sport → skill → mic and persists the picks, then hands off to the tour', async () => {
    const { getByTestId, getByText } = render(<Welcome />);

    fireEvent.press(getByTestId('onboarding-start'));
    // Locked sport is shown but flagged, not selectable.
    expect(getByText(/coming soon/i)).toBeTruthy();
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish'));
    });

    expect(authService.completeOnboarding).toHaveBeenCalledWith(
      'u1',
      'bjj',
      expect.any(String),
      'gi',
    );
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/tour');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });

  it('"Skip for now" still completes onboarding without requesting the mic', async () => {
    const { getByTestId } = render(<Welcome />);
    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-skip-mic'));
    });

    const av = require('expo-av');
    expect(av.Audio.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/tour');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });

  it('a failed profile save blocks completion and offers Retry', async () => {
    (authService.completeOnboarding as jest.Mock).mockRejectedValueOnce(
      new Error('Onboarding save failed: offline'),
    );
    const { getByTestId, getByText } = render(<Welcome />);
    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish'));
    });

    // NOT marked complete, NOT navigated: the profile row still says false,
    // so proceeding would bounce the user back through onboarding next launch.
    expect(router.replace).not.toHaveBeenCalled();
    expect(useUserStore.getState().onboardingComplete).toBe(false);
    expect(getByText(/couldn.t save your picks/i)).toBeTruthy();
    expect(getByTestId('onboarding-retry')).toBeTruthy();
    expect(getByTestId('onboarding-continue-anyway')).toBeTruthy();
  });

  it('Retry after a failure completes normally once the save succeeds', async () => {
    (authService.completeOnboarding as jest.Mock).mockRejectedValueOnce(
      new Error('Onboarding save failed: offline'),
    );
    const { getByTestId } = render(<Welcome />);
    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-next'));
    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish')); // fails
    });

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-retry')); // succeeds
    });

    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/tour');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });

  it('"Continue anyway" proceeds on local state only', async () => {
    (authService.completeOnboarding as jest.Mock).mockRejectedValueOnce(
      new Error('Onboarding save failed: offline'),
    );
    const { getByTestId } = render(<Welcome />);
    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-next'));
    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish')); // fails
    });

    fireEvent.press(getByTestId('onboarding-continue-anyway'));

    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/tour');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });
});

describe('onboarding attire step (#59)', () => {
  it('persists a no-gi pick to the profile row, not just the local store', async () => {
    const { getByTestId } = render(<Welcome />);

    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));
    fireEvent.press(getByTestId('onboarding-attire-no-gi'));
    fireEvent.press(getByTestId('onboarding-attire-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish'));
    });

    // Server-side, so a reinstall does not silently revert to the gi default.
    expect(authService.completeOnboarding).toHaveBeenCalledWith(
      'u1',
      'bjj',
      expect.any(String),
      'no-gi',
    );
    expect(useUserStore.getState().giDefault).toBe('no-gi');
  });
});
