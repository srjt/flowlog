// Minimal Supabase REST helpers built on `fetch` — deliberately avoids the
// `@supabase/supabase-js` remote import so the function bundles with NO network
// access. That lets `supabase functions deploy` work behind a corporate proxy
// that TLS-intercepts esm.sh / deno.land.
//
// Auth verification uses the caller's JWT (low privilege). Storage + DB use the
// service role (server-side only) after we've derived the userId from the JWT.

const baseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export interface AuthedUser {
  id: string;
  email: string | null;
}

/** Resolve the authenticated user from their JWT, or null if invalid. */
export async function getUserFromJwt(jwt: string): Promise<AuthedUser | null> {
  const res = await fetch(`${baseUrl()}/auth/v1/user`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ? { id: user.id, email: user.email ?? null } : null;
}

/** Download an object from Storage (service role; caller must own the path). */
export async function downloadAudio(
  bucket: string,
  path: string,
): Promise<Blob | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(
    `${baseUrl()}/storage/v1/object/${bucket}/${encoded}`,
    {
      headers: {
        apikey: serviceKey(),
        Authorization: `Bearer ${serviceKey()}`,
      },
    },
  );
  if (!res.ok) return null;
  return await res.blob();
}

/** PostgREST GET. `query` is e.g. `sessions?select=key_mistake&user_id=eq.x`. */
// deno-lint-ignore no-explicit-any
export async function dbSelect(query: string): Promise<any[]> {
  const res = await fetch(`${baseUrl()}/rest/v1/${query}`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) {
    throw new Error(`DB select failed: ${res.status} ${await safeText(res)}`);
  }
  return await res.json();
}

/** PostgREST insert returning the created row. */
export async function dbInsert(
  table: string,
  row: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`DB insert failed: ${res.status} ${await safeText(res)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

/** PostgREST upsert (merge on the table's primary key). */
export async function dbUpsert(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${baseUrl()}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`DB upsert failed: ${res.status} ${await safeText(res)}`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
