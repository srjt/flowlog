// Mock the Supabase client so no real network/AppState side effects run.
// Factory-local jest.fn()s (jest only allows `mock`-prefixed outer refs).
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
  },
}));

// eslint-disable-next-line import/first
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line import/first
import { authService } from '@/services/AuthService';

const getSession = supabase.auth.getSession as jest.Mock;
const getUser = supabase.auth.getUser as jest.Mock;

describe('AuthService.getSessionUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recovers the persisted session (refreshing the token) before verifying the user', async () => {
    // getSession() is the seam that refreshes an expired access token via the
    // stored refresh token — a day-old session recovers instead of logging out.
    getSession.mockResolvedValue({
      data: { session: { access_token: 'freshly-refreshed' } },
      error: null,
    });
    getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com' } },
      error: null,
    });

    const user = await authService.getSessionUser();

    expect(getSession).toHaveBeenCalled();
    expect(getUser).toHaveBeenCalled();
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('returns null and never verifies when there is no persisted session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    expect(await authService.getSessionUser()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns null when the session recovery itself errors', async () => {
    getSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'network' },
    });

    expect(await authService.getSessionUser()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns null when server-side user verification fails', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'fresh' } },
      error: null,
    });
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    });

    expect(await authService.getSessionUser()).toBeNull();
  });
});
