import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import { env } from '@/config/env';

/**
 * Single shared Supabase client. Auth tokens persist via AsyncStorage so the
 * user stays signed in across app launches. Anything that needs the DB, auth,
 * or storage imports this client — but only through provider/store layers,
 * never directly from a screen.
 *
 * PKCE flow is used so OAuth works without any client secret. On web the SDK
 * parses the session from the OAuth redirect URL automatically; on native we
 * complete the exchange in AuthService after the browser session returns.
 */
const isWeb = Platform.OS === 'web';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
    flowType: 'pkce',
  },
});

/**
 * Keep the session fresh while the app is in use. Supabase's token
 * auto-refresh runs on a timer that must be told when to run: on native it only
 * makes sense while the app is foregrounded. Without this, the timer can stop
 * while the app is backgrounded and the access token silently goes stale — so a
 * user who reopens the app later finds themselves logged out. Tie it to
 * AppState: refresh on foreground, pause on background. Web manages this itself.
 */
if (!isWeb) {
  // Pause only when clearly backgrounded; treat 'active' AND the transient
  // 'unknown' launch state as foreground, so refresh is never left paused at
  // startup (which could otherwise strand the timer until the next AppState
  // change that may never come if the app is already active).
  const syncAutoRefresh = (state: string) => {
    if (state === 'background' || state === 'inactive') {
      void supabase.auth.stopAutoRefresh();
    } else {
      void supabase.auth.startAutoRefresh();
    }
  };
  AppState.addEventListener('change', syncAutoRefresh);
  // Cover the initial foreground (the listener only fires on a change).
  syncAutoRefresh(AppState.currentState ?? 'active');
}
