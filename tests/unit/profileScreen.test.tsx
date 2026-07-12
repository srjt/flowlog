import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: false,
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('@/services/AuthService', () => ({
  authService: {
    updateProfile: jest.fn().mockResolvedValue(undefined),
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
}));
// Settings sections pull notification plumbing that's irrelevant here.
jest.mock('@/components/ReminderSettings', () => ({
  ReminderSettings: () => null,
}));
jest.mock('@/components/DigestSettings', () => ({
  DigestSettings: () => null,
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
import ProfileScreen from '../../app/(tabs)/profile';

describe('ProfileScreen', () => {
  beforeEach(() => {
    useUserStore.setState({
      authUser: { id: 'u1', email: 'a@b.com' },
      activeSport: 'bjj',
      skillLevel: 'White Belt',
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('persists a skill change to the profile row', async () => {
    const { getByText } = render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByText('Blue Belt'));
    });

    expect(useUserStore.getState().skillLevel).toBe('Blue Belt');
    expect(authService.updateProfile).toHaveBeenCalledTimes(1);
    expect(authService.updateProfile).toHaveBeenCalledWith('u1', {
      skillLevel: 'Blue Belt',
    });
  });

  it('shows a save hint when the profile write fails (local pick kept)', async () => {
    (authService.updateProfile as jest.Mock).mockRejectedValueOnce(
      new Error('offline'),
    );
    const { getByText, findByText } = render(<ProfileScreen />);
    await act(async () => {
      fireEvent.press(getByText('Blue Belt'));
    });

    expect(await findByText(/may not stick/i)).toBeTruthy();
    expect(useUserStore.getState().skillLevel).toBe('Blue Belt');
  });

  it('requires an explicit confirm before deleting the account', async () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);
    expect(queryByTestId('account-delete-confirm')).toBeNull();

    fireEvent.press(getByTestId('account-delete'));
    expect(getByTestId('account-delete-confirm')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('account-delete-confirm'));
    });

    expect(authService.deleteAccount).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/(auth)/login'),
    );
  });

  it('stays signed in and shows an error when deletion fails', async () => {
    (authService.deleteAccount as jest.Mock).mockRejectedValueOnce(
      new Error('server down'),
    );
    const { getByTestId, findByText } = render(<ProfileScreen />);
    fireEvent.press(getByTestId('account-delete'));
    await act(async () => {
      fireEvent.press(getByTestId('account-delete-confirm'));
    });

    expect(await findByText(/couldn.t delete your account/i)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('cancel dismisses the delete confirmation without calling the service', () => {
    const { getByTestId, queryByTestId } = render(<ProfileScreen />);
    fireEvent.press(getByTestId('account-delete'));
    fireEvent.press(getByTestId('account-delete-cancel'));

    expect(queryByTestId('account-delete-confirm')).toBeNull();
    expect(authService.deleteAccount).not.toHaveBeenCalled();
  });
});
