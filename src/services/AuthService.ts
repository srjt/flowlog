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
   * redirects the page and parses the returned session automatically. On native
   * we open an in-app browser session and exchange the returned code for a
   * session. The auth-state listener in the root layout then loads the profile.
   */
  async signInWithOAuth(provider: OAuthProvider): Promise<void> {
    const redirectTo = redirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
    });
    if (error) throw new Error(error.message);
    if (Platform.OS === 'web' || !data?.url) return; // web redirects the page

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) return; // user cancelled
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error('Sign-in did not return an authorization code.');
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(exchangeError.message);
  }

  /** Send a password-reset email. Always resolves so we don't leak which emails exist. */
  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl(),
    });
    if (error) throw new Error(error.message);
  }

  async getSessionUser(): Promise<AuthUser | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ? toAuthUser(data.session.user) : null;
  }

  /** Subscribe to auth changes; returns an unsubscribe function. */
  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ? toAuthUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
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
   * Called once when the user finishes the first-run flow.
   */
  async completeOnboarding(
    userId: string,
    activeSport: SportKey,
    skillLevel: SkillLevel,
  ): Promise<void> {
    await supabase
      .from('profiles')
      .update({
        active_sport: activeSport,
        skill_level: skillLevel,
        onboarding_complete: true,
      })
      .eq('id', userId);
  }
}

function toAuthUser(user: { id: string; email?: string | null }): AuthUser {
  return { id: user.id, email: user.email ?? null };
}

export const authService = new AuthService();
