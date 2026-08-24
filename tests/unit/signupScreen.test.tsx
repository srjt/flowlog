import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import SignupScreen from '../../app/(auth)/signup';

describe('signup screen is an invite-only notice (#77)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('explains that the product is invite-only', () => {
    const { getByText } = render(<SignupScreen />);
    expect(getByText('Flowlog is invite-only')).toBeTruthy();
  });

  it('never calls signUp — public signup is disabled on the project', () => {
    // Left as a real form, tapping it would return "Signups not allowed for
    // this instance", which reads as a bug rather than a policy.
    const authService = require('@/services/AuthService').authService;
    const spy = jest.spyOn(authService, 'signUp');
    render(<SignupScreen />);
    expect(spy).not.toHaveBeenCalled();
  });

  it('offers a way back to log in rather than a dead end', () => {
    const { getByTestId } = render(<SignupScreen />);
    fireEvent.press(getByTestId('signup-back-to-login'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('tells an already-invited person what to do', () => {
    const { getByText } = render(<SignupScreen />);
    expect(getByText(/check your email for the invitation/i)).toBeTruthy();
  });
});
