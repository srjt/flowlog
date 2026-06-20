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

  it('walks sport → skill → mic and persists the picks, then opens the recorder', async () => {
    const { getByTestId, getByText } = render(<Welcome />);

    fireEvent.press(getByTestId('onboarding-start'));
    // Locked sport is shown but flagged, not selectable.
    expect(getByText(/coming soon/i)).toBeTruthy();
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-finish'));
    });

    expect(authService.completeOnboarding).toHaveBeenCalledWith(
      'u1',
      'bjj',
      expect.any(String),
    );
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/record');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });

  it('"Skip for now" still completes onboarding without requesting the mic', async () => {
    const { getByTestId } = render(<Welcome />);
    fireEvent.press(getByTestId('onboarding-start'));
    fireEvent.press(getByTestId('onboarding-sport-next'));
    fireEvent.press(getByTestId('onboarding-skill-next'));

    await act(async () => {
      fireEvent.press(getByTestId('onboarding-skip-mic'));
    });

    const av = require('expo-av');
    expect(av.Audio.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/record');
    expect(useUserStore.getState().onboardingComplete).toBe(true);
  });
});
