import AsyncStorage from '@react-native-async-storage/async-storage';

import { env } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * TEMPORARY, TESTING ONLY. Bootstraps a fixed test account's session directly
 * into device storage on launch, bypassing every Supabase-js sign-in method
 * (`signInWithPassword`, `signInWithOAuth`, `exchangeCodeForSession`, ...) —
 * and therefore every code path implicated in the sign-in crash under
 * investigation (see docs/SDK54_UPGRADE.md). Makes a raw `fetch()` call to
 * Supabase's own token endpoint (matching exactly what a real password
 * sign-in would return) and writes the result straight into the same storage
 * key `supabase.auth.getSession()` restores from on cold launch — so the rest
 * of the app (profile, sessions, the real pipeline) sees a normal,
 * already-authenticated user with no login/signup screen involved.
 *
 * No-ops if a session already exists, or if anything about the request fails
 * — this must never be able to crash or block app startup.
 *
 * Delete this file, its one call site in app/_layout.tsx, and the
 * EXPO_PUBLIC_AUTH_BYPASS_* env vars once real sign-in is fixed.
 */
export async function bootstrapAuthBypassSession(): Promise<void> {
  const storageKey = `sb-${new URL(env.SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

  try {
    const existing = await AsyncStorage.getItem(storageKey);
    if (existing) return;

    const response = await fetch(
      `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: env.AUTH_BYPASS_EMAIL,
          password: env.AUTH_BYPASS_PASSWORD,
        }),
      },
    );
    const session = await response.json();
    if (!response.ok || !session.access_token) {
      logger.warn('auth bypass sign-in failed', session);
      return;
    }
    await AsyncStorage.setItem(storageKey, JSON.stringify(session));
  } catch (err) {
    logger.warn('auth bypass bootstrap failed', err);
  }
}
