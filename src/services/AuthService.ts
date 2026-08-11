import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { SportKey } from '@/types/sport';
import type { AuthUser, SkillLevel, UserProfile } from '@/types/user';

/** OAuth providers we offer. Apple is required on iOS when any social login exists. */
export type OAuthProvider = 'google' | 'apple';

/** Deep link the OAuth/reset redirect returns to. Web uses the page origin. */
function redirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return Linking.createURL('/(auth)/login');
}

/**
 * Real Supabase auth + profile access for the production path. The login/signup
 * screens and the root layout's session restore use this. In demo / local-test
 * mode the app auto-signs-in a dev user instead and never calls this.
 */
export class AuthService {
  async signIn(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) {
      throw new Error(error?.message ?? 'Sign-in failed.');
    }
    return toAuthUser(data.user);
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) {
      throw new Error(error?.message ?? 'Sign-up failed.');
    }
    const user = toAuthUser(data.user);
    await this.ensureProfile(user.id);
    return user;
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  /**
   * Sign in with an OAuth provider (PKCE — no client secret). On web the SDK
   * redirects the page and parses the returned session automatically — the
   * caller doesn't need to do anything further. On native we open an in-app
   * browser session and exchange the returned code for a session ourselves;
   * returns true only when that exchange actually completes, so the caller
   * knows to navigate (the auth-state listener in the root layout loads the
   * profile, but nothing else ever navigates away from wherever this was
   * called from — unlike the email/password screens, which do it explicitly).
   *
   * `openAuthSessionAsync`'s own result can unreliably report 'dismiss'/'cancel'
   * even when the provider auto-completed via an already-signed-in session (a
   * known Expo issue — expo/expo#6289) — the sheet closes very fast and the
   * promise resolves before it correctly captures the redirect. The OS still
   * delivers the redirect to the app as a normal deep link in that case (it's
   * our own registered `flowlog://` scheme), typically a beat after the browser
   * promise settles, so an inconclusive result waits briefly for a `Linking`
   * listener to catch it as a fallback source for the redirect URL.
   */
  async signInWithOAuth(provider: OAuthProvider): Promise<boolean> {
    const redirectTo = redirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
    });
    if (error) throw new Error(error.message);
    if (Platform.OS === 'web' || !data?.url) return false; // web redirects the page

    let resolveDeepLink: (url: string) => void;
    const deepLinkArrived = new Promise<string>((resolve) => {
      resolveDeepLink = resolve;
    });
    const linkingSub = Linking.addEventListener('url', (event) => {
      if (event.url.startsWith(redirectTo)) resolveDeepLink(event.url);
    });

    let finalUrl: string | null;
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );
      finalUrl =
        result.type === 'success' && result.url
          ? result.url
          : await Promise.race([
              deepLinkArrived,
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 1500),
              ),
            ]);
    } finally {
      linkingSub.remove();
    }
    if (!finalUrl) return false; // user genuinely cancelled — no redirect ever arrived

    const code = new URL(finalUrl).searchParams.get('code');
    if (!code) throw new Error('Sign-in did not return an authorization code.');
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(exchangeError.message);
    return true;
  }

  /** Send a password-reset email. Always resolves so we don't leak which emails exist. */
  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl(),
    });
    if (error) throw new Error(error.message);
  }

  /**
   * Restore the signed-in user on cold launch.
   *
   * `getSession()` first: it reads the persisted tokens and, when the access
   * token has expired, refreshes it using the stored refresh token — so a
   * returning user (e.g. opening the app a day later, once the ~1h access token
   * is long expired) is recovered instead of being logged out. Calling
   * `getUser()` alone here was the bug: it sends the CURRENT access token to the
   * server without refreshing, so an expired token just returned an error and
   * the app dropped the user to login while a valid refresh token sat unused.
   *
   * Then `getUser()` to re-verify against the server (Supabase's documented best
   * practice — `session.user` isn't re-verified server-side). By this point the
   * access token is fresh, so the round-trip succeeds. Both steps need network.
   */
  async getSessionUser(): Promise<AuthUser | null> {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) return null;

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return toAuthUser(data.user);
  }

  /**
   * Subscribe to sign-outs only (session revoked elsewhere, refresh token
   * expired, etc.) — NOT sign-ins. Every sign-in path in this app (password
   * login/signup, both OAuth `onSuccess` handlers, and this service's own
   * session-restore call on cold launch) already sets the store explicitly
   * and deterministically with its own result. Reacting to SIGNED_IN here too
   * raced a second, independent getUser()/getProfile() chain against the same
   * store on every sign-in — two concurrent chains landing on Hermes's
   * microtask queue at nearly the same tick, which crashed the app outright.
   * See docs/SDK54_UPGRADE.md.
   */
  onAuthChange(cb: (user: null) => void): () => void {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) cb(null);
      },
    );
    return () => subscription.subscription.unsubscribe();
  }

  /** Create the profile row on first sign-up if it doesn't exist (RLS-scoped). */
  async ensureProfile(userId: string): Promise<void> {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (!data) {
      await supabase.from('profiles').insert({
        id: userId,
        active_sport: 'bjj',
        skill_level: 'White Belt',
      });
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const { data } = await supabase
      .from('profiles')
      .select()
      .eq('id', userId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      displayName: data.display_name ?? null,
      activeSport: (data.active_sport ?? 'bjj') as SportKey,
      skillLevel: data.skill_level ?? null,
      onboardingComplete: data.onboarding_complete ?? false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Persist the onboarding picks (sport + skill) and mark the profile onboarded.
   * Called once when the user finishes the first-run flow. Throws on failure —
   * the caller must NOT mark onboarding complete locally when the profile row
   * still says otherwise (the next cold launch reads the row and would bounce
   * the user back through onboarding, losing their picks).
   */
  async completeOnboarding(
    userId: string,
    activeSport: SportKey,
    skillLevel: SkillLevel,
  ): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({
        active_sport: activeSport,
        skill_level: skillLevel,
        onboarding_complete: true,
      })
      .eq('id', userId);
    if (error) throw new Error(`Onboarding save failed: ${error.message}`);
  }

  /**
   * Permanently delete the signed-in user's account: audio recordings, all
   * rows, and the auth user itself (server-side via the delete-account edge
   * function — the client has no privileges to do any of this directly).
   */
  async deleteAccount(): Promise<void> {
    const { error } = await supabase.functions.invoke('delete-account', {
      body: { confirm: true },
    });
    if (error) {
      throw new Error(error.message ?? 'Account deletion failed.');
    }
  }

  /**
   * Persist sport/skill changes made from Profile so they survive reinstall
   * and other devices. Never touches onboarding_complete.
   */
  async updateProfile(
    userId: string,
    fields: { activeSport?: SportKey; skillLevel?: SkillLevel },
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (fields.activeSport !== undefined) {
      patch.active_sport = fields.activeSport;
    }
    if (fields.skillLevel !== undefined) patch.skill_level = fields.skillLevel;
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId);
    if (error) throw new Error(`Profile update failed: ${error.message}`);
  }
}

function toAuthUser(user: { id: string; email?: string | null }): AuthUser {
  return { id: user.id, email: user.email ?? null };
}

export const authService = new AuthService();
