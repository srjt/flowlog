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

/** PostgREST PATCH returning the updated row, e.g. `dbUpdate('sessions?id=eq.'+id, {...})`. */
export async function dbUpdate(
  query: string,
  patch: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const res = await fetch(`${baseUrl()}/rest/v1/${query}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`DB update failed: ${res.status} ${await safeText(res)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

/** PostgREST DELETE, e.g. `dbDelete(`sessions?user_id=eq.${id}`)`. */
export async function dbDelete(query: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/rest/v1/${query}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) {
    throw new Error(`DB delete failed: ${res.status} ${await safeText(res)}`);
  }
}

/**
 * List object paths under a folder (service role). Returns FULL paths
 * (prefix included) ready for `deleteStorageObjects`. Folders come back with
 * a null id and are filtered out; audio paths are flat (`{userId}/{ts}.m4a`).
 */
export async function listStorageObjects(
  bucket: string,
  folder: string,
): Promise<string[]> {
  const res = await fetch(`${baseUrl()}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefix: folder, limit: 1000, offset: 0 }),
  });
  if (!res.ok) {
    throw new Error(
      `Storage list failed: ${res.status} ${await safeText(res)}`,
    );
  }
  const items = (await res.json()) as Array<{
    name: string;
    id: string | null;
  }>;
  return items.filter((i) => i.id !== null).map((i) => `${folder}/${i.name}`);
}

/** Bulk-delete storage objects (the endpoint supabase-js `remove()` uses). */
export async function deleteStorageObjects(
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const res = await fetch(`${baseUrl()}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    throw new Error(
      `Storage delete failed: ${res.status} ${await safeText(res)}`,
    );
  }
}

/** Delete the auth user itself (admin endpoint, service role). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) {
    throw new Error(`Auth delete failed: ${res.status} ${await safeText(res)}`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
