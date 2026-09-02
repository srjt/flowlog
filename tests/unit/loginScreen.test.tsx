import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('@/services/AuthService', () => ({
  authService: {
    signIn: jest.fn(),
    ensureProfile: jest.fn(),
    getProfile: jest.fn(),
    signInWithOAuth: jest.fn(async () => undefined),
    sendPasswordReset: jest.fn(async () => undefined),
  },
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import { authService } from '@/services/AuthService';
// eslint-disable-next-line import/first
import { router } from 'expo-router';
// eslint-disable-next-line import/first
import LoginScreen from '../../app/(auth)/login';

describe('LoginScreen', () => {
  afterEach(() => jest.clearAllMocks());

  it('starts Google OAuth via Supabase (no secrets in client)', async () => {
    const { getByTestId } = render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('oauth-google'));
    });
    expect(authService.signInWithOAuth).toHaveBeenCalledWith('google');
  });

  it('sends a signed-in user through the entry gate, not straight to a tab', async () => {
    (authService.signIn as jest.Mock).mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
    });
    const { getByTestId, getByText } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('login-email'), 'a@b.com');
    fireEvent.changeText(getByTestId('login-password'), 'hunter2hunter2');
    await act(async () => {
      fireEvent.press(getByText('Log in'));
    });

    // The gate owns the onboarding and feature-tour checks; jumping to
    // /(tabs)/record here would skip both for a returning user.
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('requires an email before sending a reset, then triggers it with feedback', async () => {
    const { getByTestId, getByText, queryByText } = render(<LoginScreen />);

    // No email yet → guidance, no network call.
    fireEvent.press(getByTestId('forgot-password'));
    expect(authService.sendPasswordReset).not.toHaveBeenCalled();
    expect(getByText(/Enter your email first/i)).toBeTruthy();

    fireEvent.changeText(getByTestId('login-email'), 'a@b.com');
    await act(async () => {
      fireEvent.press(getByTestId('forgot-password'));
    });
    expect(authService.sendPasswordReset).toHaveBeenCalledWith('a@b.com');
    expect(queryByText(/reset link sent to a@b.com/i)).toBeTruthy();
  });
});
