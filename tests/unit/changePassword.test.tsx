import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

// One seam: Profile rendered over a faked Supabase client, with the real
// AuthService underneath — so each case asserts what the athlete sees AND what
// Supabase was asked to do. (profileScreen.test.tsx fakes AuthService instead.)
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
      signInWithPassword: jest.fn(),
      updateUser: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));
// Mutable so one case can switch demo mode on; read at render time.
const mockFlags = { isDemoMode: false, isLocalPipeline: false };
jest.mock('@/config/featureFlags', () => ({
  get isDemoMode() {
    return mockFlags.isDemoMode;
  },
  get isLocalPipeline() {
    return mockFlags.isLocalPipeline;
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
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
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line import/first
import { authService } from '@/services/AuthService';
// eslint-disable-next-line import/first
import { useUserStore } from '@/store/userStore';
// eslint-disable-next-line import/first
import ProfileScreen from '../../app/(tabs)/profile';

const auth = supabase.auth as unknown as Record<
  'getSession' | 'getUser' | 'signInWithPassword' | 'updateUser' | 'signOut',
  jest.Mock
>;

const EMAIL = 'athlete@example.com';
const CURRENT = 'temporary-pass-1';
const NEW = 'my-own-password';

function supabaseUser(providers: string[]) {
  return { id: 'u1', email: EMAIL, app_metadata: { providers } };
}

/** Restore a session the way the root layout does on launch, then render. */
async function renderSignedInAs(providers: string[]) {
  const user = supabaseUser(providers);
  auth.getSession.mockResolvedValue({
    data: { session: { user } },
    error: null,
  });
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  useUserStore.getState().setAuthUser(await authService.getSessionUser());
  return render(<ProfileScreen />);
}

const field = (label: string) => screen.getByLabelText(label);
const saveButton = () =>
  screen.getByRole('button', { name: 'Save new password' });

function fill(current: string, next: string, confirm: string) {
  fireEvent.changeText(field('Current password'), current);
  fireEvent.changeText(field('New password'), next);
  fireEvent.changeText(field('Confirm new password'), confirm);
}

async function openAndSave(current: string, next: string, confirm: string) {
  fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
  fill(current, next, confirm);
  await act(async () => {
    fireEvent.press(saveButton());
  });
}

function expectTypedValues(current: string, next: string, confirm: string) {
  expect(field('Current password').props.value).toBe(current);
  expect(field('New password').props.value).toBe(next);
  expect(field('Confirm new password').props.value).toBe(confirm);
}

const VERIFIED = {
  data: { user: supabaseUser(['email']), session: {} },
  error: null,
};
const UPDATED = { data: { user: supabaseUser(['email']) }, error: null };

describe('Profile › Change password', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    // Failures are logged on purpose; keep the expected ones out of the output.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFlags.isDemoMode = false;
    mockFlags.isLocalPipeline = false;
    useUserStore.getState().reset();
  });

  describe('row visibility', () => {
    it('is hidden when signed out', () => {
      render(<ProfileScreen />);
      expect(
        screen.queryByRole('button', { name: 'Change password' }),
      ).toBeNull();
    });

    it('is hidden in demo mode, even for an email account', async () => {
      mockFlags.isDemoMode = true;
      await renderSignedInAs(['email']);
      expect(
        screen.queryByRole('button', { name: 'Change password' }),
      ).toBeNull();
    });

    it('is hidden for a Google-only account', async () => {
      await renderSignedInAs(['google']);
      expect(
        screen.queryByRole('button', { name: 'Change password' }),
      ).toBeNull();
    });

    it.each([[['email']], [['google', 'email']]])(
      'is shown for an account with providers %j',
      async (providers) => {
        await renderSignedInAs(providers);
        expect(
          screen.getByRole('button', { name: 'Change password' }),
        ).toBeTruthy();
      },
    );

    it('stays a single row until tapped', async () => {
      await renderSignedInAs(['email']);
      expect(screen.queryByLabelText('Current password')).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'Change password' }));

      expect(field('Current password')).toBeTruthy();
      expect(field('New password')).toBeTruthy();
      expect(field('Confirm new password')).toBeTruthy();
    });
  });

  it.each([
    ['an empty field', '', NEW, NEW, /fill in all three fields/i],
    ['a mismatched confirmation', CURRENT, NEW, `${NEW}x`, /don.t match/i],
    [
      'a new password under 8 characters',
      CURRENT,
      'short1',
      'short1',
      /must be at least 8 characters/i,
    ],
    [
      'a new password equal to the current one',
      CURRENT,
      CURRENT,
      CURRENT,
      /different from your current/i,
    ],
  ])(
    'explains %s without calling Supabase',
    async (_case, current, next, confirm, message) => {
      await renderSignedInAs(['email']);
      await openAndSave(current, next, confirm);

      expect(screen.getByText(message)).toBeTruthy();
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expectTypedValues(current, next, confirm);
    },
  );

  it('says the current password is incorrect and never updates it', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
        status: 400,
      },
    });
    await renderSignedInAs(['email']);
    await openAndSave('wrong-guess-1', NEW, NEW);

    expect(screen.getByText(/current password is incorrect/i)).toBeTruthy();
    expect(screen.queryByText(/invalid login credentials/i)).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    // The wrong one must be retyped; the new password is kept.
    expectTypedValues('', NEW, NEW);
  });

  it('verifies the current password, then sets the new one, and stays signed in', async () => {
    auth.signInWithPassword.mockResolvedValue(VERIFIED);
    auth.updateUser.mockResolvedValue(UPDATED);
    await renderSignedInAs(['email', 'google']);
    await openAndSave(CURRENT, NEW, NEW);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: CURRENT,
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: NEW });
    const [verifiedAt] = auth.signInWithPassword.mock.invocationCallOrder;
    const [updatedAt] = auth.updateUser.mock.invocationCallOrder;
    expect(verifiedAt).toBeLessThan(updatedAt ?? -1);

    expect(screen.getByText(/password changed/i)).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(useUserStore.getState().authUser?.id).toBe('u1');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('explains a new password the server rejects, keeping what was typed', async () => {
    auth.signInWithPassword.mockResolvedValue(VERIFIED);
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'weak_password',
        message: 'Password is known to be weak and easy to guess',
        status: 422,
      },
    });
    await renderSignedInAs(['email']);
    await openAndSave(CURRENT, NEW, NEW);

    expect(screen.getByText(/wasn.t accepted/i)).toBeTruthy();
    expect(screen.queryByText(/known to be weak/i)).toBeNull();
    expectTypedValues(CURRENT, NEW, NEW);
  });

  it.each([
    [
      'the verify step cannot reach the server',
      () =>
        auth.signInWithPassword.mockResolvedValue({
          data: { user: null, session: null },
          error: {
            name: 'AuthRetryableFetchError',
            message: 'Failed to fetch',
            status: 0,
          },
        }),
    ],
    [
      'the update step throws',
      () => {
        auth.signInWithPassword.mockResolvedValue(VERIFIED);
        auth.updateUser.mockRejectedValue(
          new TypeError('Network request failed'),
        );
      },
    ],
  ])(
    'gives a plain retry message when %s, keeping what was typed',
    async (_case, arrange) => {
      arrange();
      await renderSignedInAs(['email']);
      await openAndSave(CURRENT, NEW, NEW);

      expect(
        screen.getByText(/check your connection and try again/i),
      ).toBeTruthy();
      expect(
        screen.queryByText(/failed to fetch|network request failed/i),
      ).toBeNull();
      expectTypedValues(CURRENT, NEW, NEW);
      expect(router.replace).not.toHaveBeenCalled();
    },
  );

  it('shows a loading Save while saving, and a second tap does nothing', async () => {
    let finishVerify: (value: typeof VERIFIED) => void = () => undefined;
    auth.signInWithPassword.mockReturnValue(
      new Promise((resolve) => {
        finishVerify = resolve;
      }),
    );
    auth.updateUser.mockResolvedValue(UPDATED);
    await renderSignedInAs(['email']);
    await openAndSave(CURRENT, NEW, NEW);

    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText('Save')).toBeNull(); // spinner in its place
    await act(async () => {
      fireEvent.press(saveButton());
    });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishVerify(VERIFIED);
    });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/password changed/i)).toBeTruthy();
  });

  it('Cancel closes the form and clears what was typed', async () => {
    await renderSignedInAs(['email']);
    fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    fill(CURRENT, NEW, NEW);

    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Current password')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    expectTypedValues('', '', '');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
