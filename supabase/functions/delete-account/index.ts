// Account deletion — required by App Store 5.1.1(v) and basic trust for an
// app that stores voice recordings. The caller proves identity via their JWT;
// everything is then removed with the service role: audio objects, all rows,
// and finally the auth user itself. Every step is idempotent (empty lists and
// missing rows no-op), so a failed request is safely retryable end-to-end.
//
// Deploy:   supabase functions deploy delete-account
// Same zero-remote-import style as process-session (see supabaseRest.ts).

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  dbDelete,
  deleteAuthUser,
  deleteStorageObjects,
  getUserFromJwt,
  listStorageObjects,
} from '../_shared/supabaseRest.ts';

const AUDIO_BUCKET = 'session-audio';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let userId: string | null = null;
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(
      /^Bearer\s+/i,
      '',
    );
    const user = jwt ? await getUserFromJwt(jwt) : null;
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    userId = user.id;

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return jsonResponse({ error: 'Missing confirmation' }, 400);
    }

    // 1. Audio objects (paged in case of >1000; paths are flat under {userId}/).
    for (;;) {
      const paths = await listStorageObjects(AUDIO_BUCKET, user.id);
      if (paths.length === 0) break;
      await deleteStorageObjects(AUDIO_BUCKET, paths);
      if (paths.length < 1000) break;
    }

    // 2. Rows: children before the profile (sessions/user_trends FK-reference
    //    profiles). client_events has no FK but holds the user's error data.
    await dbDelete(`client_events?user_id=eq.${user.id}`);
    await dbDelete(`sessions?user_id=eq.${user.id}`);
    await dbDelete(`user_trends?user_id=eq.${user.id}`);
    await dbDelete(`profiles?id=eq.${user.id}`);

    // 3. The auth user last — after this the caller's JWT is dead.
    await deleteAuthUser(user.id);

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error(
      `delete-account failed [user=${userId ?? 'unauth'}]:`,
      (err as Error)?.message,
      (err as Error)?.stack,
    );
    return jsonResponse(
      { error: (err as Error).message ?? 'Delete failed' },
      500,
    );
  }
});
