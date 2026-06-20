import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
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
