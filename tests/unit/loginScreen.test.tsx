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
