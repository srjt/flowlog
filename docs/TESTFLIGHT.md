# Shipping Flowlog to TestFlight

Backend is already deployed. This covers the iOS build + distribution only.
Everything cloud-builds with EAS, so you do **not** need Xcode or a Mac build
machine — just an Apple Developer account.

## 0. Prerequisites (one-time, ~20 min)

- **Apple Developer Program** membership ($99/yr) — enroll at
  <https://developer.apple.com/programs/>. Approval can take a few hours.
- **Expo account** — `npx expo login` (free).
- Install the CLI ad hoc (no global install needed): commands below use `npx eas-cli@latest`.

These are **already filled in** for this project (`eas.json` →
`submit.testflight.ios`, and the App Store Connect record exists). This table is
here for a fresh setup or if the account changes:

| Field         | Where to find it                                                        |
|---------------|-------------------------------------------------------------------------|
| `appleId`     | Your Apple Developer login email                                        |
| `appleTeamId` | <https://developer.apple.com/account> → Membership → Team ID (10 chars) |
| `ascAppId`    | Created in step 2 below (App Store Connect app's Apple ID, numeric)     |

## 1. Pre-flight: validate for EAS PARITY, not just locally

A cloud build is metered **by the number STARTED, not by success** — a build
that dies in "Install dependencies" still burns one from the monthly quota. So
run all of this and see it green before spending one:

```bash
git status --porcelain            # must be empty; eas.json sets requireCommit
npm test && npm run typecheck && npm run lint
npx expo export                   # catches bundler breakage cheaply
npx npm@10.8.2 ci                 # THE one that catches EAS install failures
```

**Why the pinned npm.** The EAS image ships **npm 10.8.2**; local dev is often
on npm 11, which dedupes nested deps out of the lockfile that npm 10 still
requires. The result is a local `npm ci` that passes and an EAS build that fails
"Install dependencies" with `Missing: … from lock file` — after the quota is
already spent. Any change touching `package.json` must regenerate the lockfile
with `npx npm@10.8.2 install --package-lock-only` and commit both together.

**Do not bump `app.json` `version`.** The build number auto-increments via EAS
(`autoIncrement: true`). `runtimeVersion` policy is `appVersion`, so bumping the
version orphans already-shipped builds off the OTA update stream. Version bumps
happen only alongside a deliberate, planned build.

> **Leave `newArchEnabled: true` alone.** An earlier version of this document
> told you to flip it off if the native compile failed. That advice was written
> for SDK 51 and is now actively wrong: on SDK 54, Reanimated 4 REQUIRES the New
> Architecture, and turning it off breaks the build rather than rescuing it.
> ADR 0009, which that advice came from, applied only to SDK 51. Builds have
> since succeeded with New Architecture on — see `docs/SDK54_UPGRADE.md`.

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

## 5. How your testers install + sign up

Send testers this short script:

1. Install **TestFlight** from the App Store (free).
2. Open the invite email → tap **View in TestFlight** / **Accept** → **Install**.
3. Open Flowlog. On first launch they hit the **account-first onboarding**
   (`app/(onboarding)/`): they create an account with email + password (or
   "Continue with Google"), then land in the app.
4. Record a 60–90s reflection after training → get their coaching cue.

No invite codes or allow-list in the app — anyone with the TestFlight build can
sign up. Account creation is the gate.

An **internal** testing group holds up to 100 testers and needs no Apple review,
so a 20-50 person cohort ships the moment the build finishes processing. External
groups do require review; you do not need one at this size.

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

## Shipping a change: OTA or a new build?

Most changes after the first build do **not** need a cloud build. OTA updates
are free, instant, and go to the existing TestFlight app:

```bash
npx eas-cli@latest update --channel testflight
```

**The trap.** `runtimeVersion` policy is `appVersion`. Compatibility is decided
by that string alone — so an OTA is delivered to any installed build sharing the
version, **even when the native layer has changed underneath it**. Nothing warns
you. The update lands and the app crashes wherever it touches a native module
the installed binary does not have.

So the version string is not the check. **The fingerprint is:**

```bash
npx expo-updates fingerprint:generate --platform ios     # ends with "hash":"…"
npx eas-cli@latest build:list --platform ios --limit 1   # "Fingerprint" of the installed build
```

| fingerprints | ship it with |
| --- | --- |
| identical | `eas update` — free, instant |
| **differ** | a new `eas build` |

A real example, and the reason this section exists. 112 commits after build 29,
every changed file looked like JS — and an OTA would have been wrong. Adding
`expo-keep-awake` as a direct dependency moved the fingerprint, and
`app/(tabs)/record.tsx` calls `activateKeepAwakeAsync` on the record screen. The
version was still `0.2.0`, so the update would have shipped straight to build 29
and taken the core flow down.

If the fingerprints differ, do not reason about whether the native change "looks
safe". Build.

## Quick reference

```bash
# JS-only change, fingerprint unchanged — free, no quota spent:
npx eas-cli@latest update --channel testflight

# native change, or fingerprint differs — costs one cloud build:
git status --porcelain && npm test && npm run typecheck && npm run lint
npx expo export && npx npm@10.8.2 ci        # EAS parity; see step 1
npx eas-cli@latest build -p ios --profile testflight --auto-submit
# then in App Store Connect: add the build to the internal group (one click)
```

Only a human runs `eas build` / `eas submit` — they need interactive Apple 2FA.
An agent preps and validates; it does not spend the quota.
