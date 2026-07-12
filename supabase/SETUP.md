# Production backend setup (Supabase + Gemini)

This wires Flowlog to a real Supabase project: durable storage, real login, and
the `process-session` edge function running Gemini server-side (your key stays
on the server). Do the **deploy step from a personal network** — the corporate
proxy breaks the CLI's remote fetches.

You can do almost everything from the Supabase **dashboard** (web), which avoids
the corporate-network issues; only `functions deploy` needs the CLI.

## 1. Create the project

1. Go to <https://supabase.com/dashboard> → New project (free tier is fine).
2. Project Settings → API → copy the **Project URL** and the **anon public** key.

## 2. Point the app at it (`.env.local`)

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY

# Turn OFF the test modes so the app uses the real backend:
EXPO_PUBLIC_DEMO_MODE=false
EXPO_PUBLIC_LOCAL_PIPELINE=false
```

## 3. Create the database schema

Dashboard → SQL Editor → paste the contents of
`supabase/migrations/001_initial_schema.sql` → Run.
(Or, with the CLI linked: `supabase db push`.)

## 4. Create the audio storage bucket + policies

Dashboard → Storage → New bucket → name **`session-audio`**, Private.

Then SQL Editor → run these RLS policies so users only touch their own folder:

```sql
create policy "own audio insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'session-audio'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own audio read" on storage.objects for select to authenticated
  using (bucket_id = 'session-audio'
         and (storage.foldername(name))[1] = auth.uid()::text);
```

## 5. Set the edge-function secrets (Whisper transcription + Gemini analysis)

Dashboard → Edge Functions → Secrets (or the CLI below). Set:

```bash
supabase secrets set GEMINI_API_KEY=AIza...        # your Gemini key
supabase secrets set TRANSCRIPTION_PROVIDER=whisper # transcription on Whisper ASR
supabase secrets set OPENAI_API_KEY=sk-...          # key for Whisper (needs credit!)
supabase secrets set AI_PROVIDER=gemini             # analysis on Gemini
# optional: supabase secrets set GEMINI_MODEL=gemini-2.5-flash   # text stages
```

Production runs transcription on **Whisper** (switched 2026-07-10): Gemini's
LLM-based "transcription" hallucinated plausible sport terms into unclear gym
audio (the vocabulary priming amplified it), while Whisper is a dedicated ASR
that degrades to ordinary-word confusion instead of invented jargon, returns a
real duration (which re-arms the min-length gate — Gemini's path reported 0,
so the gate never fired), and costs ~$0.006/min. Gemini still runs the
extraction/coaching text stages. To fall back to Gemini transcription:
`supabase secrets set TRANSCRIPTION_PROVIDER=gemini`, and optionally
`GEMINI_TRANSCRIPTION_MODEL=gemini-pro-latest` (transcription-only override,
falls back to GEMINI_MODEL).

Model-name gotchas learned the hard way:
- Use Gemini's `-latest` ALIASES, not pinned versions: Google retires pinned
  models for new API users (gemini-2.5-pro 404s with "no longer available to
  new users" even though it still appears in the models LIST endpoint).
- Before pointing a secret at any model, verify with a REAL
  generateContent/transcription call — listing a model does not prove it's
  invocable with your key, and an unfunded OpenAI key fails every call with
  `insufficient_quota`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set them.

> Prefer Whisper + Claude instead? Set `TRANSCRIPTION_PROVIDER=whisper`,
> `AI_PROVIDER=claude`, and the `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` secrets.

## 6. Deploy the function (personal network)

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy process-session
```

## 7. Auth settings (for easy testing)

Dashboard → Authentication → Providers → Email. For quick testing, **disable
"Confirm email"** so you can sign up and immediately log in. (Re-enable it for
real use.)

## 8. Social login (Google OAuth) — optional

Our client calls `supabase.auth.signInWithOAuth({ provider: 'google' })` (PKCE,
**no client secret in the app**). You only configure the provider in Google Cloud
and paste the credentials into Supabase — nothing changes in the app code.

1. **Create the Google OAuth client.** <https://console.cloud.google.com> →
   APIs & Services → **Credentials** → Create credentials → **OAuth client ID**.
   - If prompted, configure the **OAuth consent screen** first (External; add your
     email as a test user while in "Testing").
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add Supabase's callback:

     ```text
     https://YOUR_PROJECT.supabase.co/auth/v1/callback
     ```

   - Create → copy the **Client ID** and **Client secret**.

2. **Enable Google in Supabase.** Dashboard → Authentication → **Providers →
   Google** → toggle on → paste the **Client ID** and **Client secret** → Save.

3. **Allow the app's return URLs.** Dashboard → Authentication → **URL
   Configuration**:
   - **Site URL**: your web dev origin, e.g. `http://localhost:8081`.
   - **Redirect URLs** (add both): `http://localhost:8081` for web and
     `flowlog://` for native (the app's scheme, used by `expo-web-browser`).

That's it — the "Continue with Google" button now works end-to-end. On web the
page redirects to Google and back; on native it opens an in-app browser and
exchanges the code for a session. The auth listener in `app/_layout.tsx` then
loads the profile and routes the user (new users land in onboarding).

> **Apple** is the same idea but heavier (paid Apple Developer account, a
> **Services ID** as the Client ID, plus a `.p8`-derived Secret Key). It's only
> required by App Store policy once you ship an iOS build with other social
> logins, and our Apple button only renders on iOS — skip it until you're
> submitting to the App Store.

## 9. Run it

```bash
pkill -f "expo start"
cd ~/flowlog && npx expo start --web --clear
```

Sign up → log in → record. The client transcodes your audio to WAV, uploads it
to `session-audio`, and calls `process-session`, which transcribes + analyzes on
Gemini and saves the session. Your Log now persists across refreshes and
devices.

## Checking production errors

Two places, both zero-infrastructure:

- **Server-side failures** (transcription, AI calls, persistence): Dashboard →
  Edge Functions → `process-session` → Logs. Every failure logs a line tagged
  `[stage=transcription|extraction|coaching|quality_gate|persistence]` and the
  user id; provider failures additionally log the HTTP status + response body.
- **Client-side errors**: the app's `logger.error` / `reportToMonitoring`
  fire-and-forget rows into `public.client_events` (insert-only RLS; read it
  from the dashboard). SQL Editor:

  ```sql
  select created_at, user_id, event, left(detail, 300) as detail
  from public.client_events
  order by created_at desc
  limit 100;
  ```

  Reporting is capped at 20 events per app launch and skipped in dev/demo/
  local modes. There is deliberately no client-side SELECT policy.

## How the pieces map

| Concern        | Where it runs                                              |
| -------------- | ---------------------------------------------------------- |
| Auth           | Supabase Auth (`src/services/AuthService.ts`)              |
| Audio upload   | `session-audio` bucket (client transcodes WebM → WAV)      |
| Transcription  | Gemini, server-side (`_shared/ai.ts`, `TRANSCRIPTION_PROVIDER`) |
| Analysis       | Gemini, server-side (`_shared/ai.ts`, `AI_PROVIDER`)       |
| Persistence    | `sessions` table (RLS-scoped to the signed-in user)        |

## Troubleshooting

- **401 from the function** → you're not signed in, or email isn't confirmed.
- **Could not download audio** → the `session-audio` bucket or its policies are
  missing (step 4).
- **Gemini malformed JSON** → bump `GEMINI_MODEL` or it's a transient model
  issue; the function already uses a large output budget.
- **Function won't deploy on corporate network** → deploy from a hotspot; the
  bundler fetches remote imports.
