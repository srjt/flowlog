# Shipping Flowlog to 20 TestFlight users

Backend is already deployed. This covers the iOS build + distribution only.
Everything cloud-builds with EAS, so you do **not** need Xcode or a Mac build
machine — just an Apple Developer account.

## 0. Prerequisites (one-time, ~20 min)

- **Apple Developer Program** membership ($99/yr) — enroll at
  <https://developer.apple.com/programs/>. Approval can take a few hours.
- **Expo account** — `npx expo login` (free).
- Install the CLI ad hoc (no global install needed): commands below use `npx eas-cli@latest`.

Grab three IDs and paste them into `eas.json` → `submit.testflight.ios`:

| Field         | Where to find it                                                        |
|---------------|-------------------------------------------------------------------------|
| `appleId`     | Your Apple Developer login email                                        |
| `appleTeamId` | <https://developer.apple.com/account> → Membership → Team ID (10 chars) |
| `ascAppId`    | Created in step 2 below (App Store Connect app's Apple ID, numeric)     |

## 1. Pre-flight: bump version + sanity check

```bash
npm test && npm run typecheck      # CLAUDE.md rule 8 — must be green
```

In `app.json`, set a real marketing version for the first invite, e.g.
`"version": "0.1.0"` → leave as is; the **build number** auto-increments via EAS
(`autoIncrement: true`), so you never hand-manage it.

> ⚠️ `app.json` has `"newArchEnabled": true`. The repo's verified build is the
> **web** export; a native New Architecture build on SDK 51 is untested here and
> is the most likely thing to fail. If the first `eas build` errors in the native
> compile, set `"newArchEnabled": false` and rebuild — that's the safe SDK 51
> config (see DECISIONS #009).

## 2. Create the app record + credentials

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
```

Let EAS create and manage your signing credentials when prompted (choose
"Let EAS handle it" for the Distribution Certificate and Provisioning Profile —
this is the part that normally requires Xcode and EAS does it for you).

Create the App Store Connect listing (needed before the first submit):
- <https://appstoreconnect.apple.com> → Apps → **+** → New App
- Platform iOS, Name "Flowlog", Bundle ID **com.flowlog.app** (must match
  `app.json`), SKU `flowlog`.
- Open the app → the numeric **Apple ID** shown is your `ascAppId` → paste into
  `eas.json`.

## 3. Build + submit to TestFlight

One command builds in the cloud AND uploads to App Store Connect:

```bash
npx eas-cli@latest build --platform ios --profile testflight --auto-submit
```

Build takes ~15–25 min. When it finishes it auto-submits; Apple then runs
automated processing (another ~5–15 min) before the build appears in TestFlight.

> For later iterations just re-run the same command — the build number bumps
> itself and testers get the update automatically.

## 4. Set up the internal testing group (instant, no review)

In App Store Connect → your app → **TestFlight** tab:

1. You'll be asked for **Test Information** + an **Export Compliance** answer
   once. Flowlog uses only standard HTTPS/TLS, so answer the encryption question
   accordingly (typically "No" to proprietary/non-exempt encryption — confirm
   for your case).
2. **Internal Testing** → create a group, e.g. "First 20".
   - Internal testers must be added as **Users** in App Store Connect first
     (Users and Access → invite each email with the *App Manager* or *Developer*
     or *Marketing* role). Internal = up to 100 testers, **no Apple review**,
     builds available in minutes.
3. Add the new build to the group → each tester gets an email invite.

> Alternative: **External testing** lets you invite by a public link / email
> without adding them as ASC users (up to 10,000), but the *first* external
> build needs a quick Apple "Beta App Review" (usually < 24h). For 20 known
> people, Internal is faster and reviewless — recommended.

## 5. How your 20 testers install + sign up

Send testers this short script:

1. Install **TestFlight** from the App Store (free).
2. Open the invite email → tap **View in TestFlight** / **Accept** → **Install**.
3. Open Flowlog. On first launch they hit the **account-first onboarding**
   (`app/(onboarding)/`): they create an account with email + password (or
   "Continue with Google"), then land in the app.
4. Record a 60–90s reflection after training → get their coaching cue.

No invite codes or allow-list in the app — anyone with the TestFlight build can
sign up. Account creation is the gate.

## 6. Backend gotchas to clear before you invite (important)

- **Email confirmation throttling.** Supabase's *built-in* email sender is rate-
  limited (~a few per hour) and not for production. With 20 people signing up in
  a short window, confirmation emails will silently throttle and testers get
  stuck. Fix one of these in the Supabase dashboard → Authentication:
  - Easiest for a closed beta: **Providers → Email → turn OFF "Confirm email"**
    (re-enable before public launch), **or**
  - Set up **custom SMTP** (Resend/Postmark/SES) under Auth → SMTP Settings.
- **OAuth redirect for native.** Auth → URL Configuration → **Redirect URLs**
  must include `flowlog://` (the app scheme) for "Continue with Google" to return
  into the app on iOS. (Web origins are separate.)
- **Apple Sign In.** App Store policy requires Sign in with Apple once you ship
  *other* social logins on iOS. Your Apple button only renders on iOS but the
  provider must be configured in Supabase + Apple Developer (Services ID + .p8
  key) before App Store review. For TestFlight internal testing it isn't blocking;
  configure it before public release.

## 7. Rotate the leaked keys (do this regardless)

`.env.local` had `EXPO_PUBLIC_OPENAI_API_KEY` and `EXPO_PUBLIC_GEMINI_API_KEY`
populated. `EXPO_PUBLIC_*` values are bundled into the client and extractable
from a shipped build, which violates CLAUDE.md rule 1. `eas.json` intentionally
omits them, but you should still **rotate both keys** and keep them only as
server-side `supabase secrets`.

## Quick reference

```bash
# every release:
npm test && npm run typecheck
npx eas-cli@latest build -p ios --profile testflight --auto-submit
# then in App Store Connect: add build to the internal group (one click)
```
