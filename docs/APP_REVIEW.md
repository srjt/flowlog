# Submitting Flowlog to App Review

What App Review needs to know about the iOS build, and the Notes for Review to
paste into App Store Connect. The build and upload steps are in
[`TESTFLIGHT.md`](./TESTFLIGHT.md).

Three guidelines decide what goes here:

- **2.5.19:** no hidden, dormant or undocumented features. Everything the app
  can do must be clear to users and to App Review.
- **2.3.1(a):** every new feature must be described specifically in Notes for
  Review.
- **2.5.2:** no downloaded code that introduces or changes features. This is
  why OTA updates have limits (see "OTA or a new build?" in `TESTFLIGHT.md`).

The source of truth for what can be opened in the app is the **route
inventory**, `src/config/routeInventory.ts`. `tests/unit/routeInventory.test.ts`
fails when a screen under `app/` is missing from it, when an entry no longer
exists, when a native screen has no visible way in, or when a route in the
inventory is not named in this doc. Keep this doc and the inventory in step.

## What is in the build

Every screen, how a person reaches it, and the route it lives at. One row per
inventory entry.

| Feature | What it does | Route | How to reach it |
| --- | --- | --- | --- |
| Entry route | Sends the person to login, onboarding, the tour or Record, by sign-in and onboarding state | `/` | App launch |
| Login | Email and password, "Continue with Google", "Continue with Apple" (iOS only), "Forgot password?" | `/login` | Signed out at launch, or "Sign out" in Profile |
| Invite-only notice | Explains that accounts are created by invitation. Nothing to fill in | `/signup` | "Flowlog is invite-only" button on login |
| Onboarding | Value intro, sport, skill level, gi or no-gi, microphone permission | `/welcome` | First sign-in |
| Feature tour | Four slides: Record, Log, Trends, Profile | `/tour` | After onboarding, and "Replay tour" in Profile |
| Record | Record a 20 to 90 second reflection, play it back, re-record or Submit. Gi / no-gi toggle. A streak strip that opens the Log | `/record` | Record tab. Also where the app opens once onboarded, and where a training reminder opens |
| Log | Past sessions grouped by week, with search and a "Needs review" filter | `/log` | Log tab, and "View log" on the result screen |
| Trends | Streak, session count, focus area, most-worked positions, recurring mistakes, mood. A lighter view, with a note, before 10 sessions | `/trends` | Trends tab |
| Profile | Sport, skill level, training reminders, weekly digest, "View weekly digests", "Replay tour", Change password (email accounts), Sign out, Delete account | `/profile` | Profile tab |
| Processing | Uploads the recording and shows each processing step, with "Try again" and "Discard" on failure | `/processing` | "Submit" on Record |
| Result | The coaching cue (25 words or fewer), a summary, cue rating (thumbs up or down, with a reason), "Review transcript", Done, View log. A one-time celebration after the first result | `/output` | Opens by itself when processing finishes |
| Session detail | Transcript, edit transcript and Re-analyze, cue rating, Share, Delete session | `/session/[id]` | Tap a session in Log, or "Cue seem off? Review transcript" on the result screen |
| Weekly digest | That week's focus area and recurring leak | `/digest` | The weekly digest notification, which the user turns on under "Weekly digest" in Profile |
| Digest history | Every past weekly digest | `/digest/history` | "View weekly digests" in Profile, or "View all digests" on the digest screen |
| Digest week | One past week's digest | `/digest/[weekId]` | Tap a week in the digest history |
| Certification bench | Invited black belts judge coaching records | `/review` | **Web build only.** In the iOS app this route redirects to the entry route and never checks reviewer access. See [`REVIEW_BENCH.md`](./REVIEW_BENCH.md) |

Both notifications are local, scheduled on the device, and off until the user
turns them on in Profile. Neither is sent from a server.

### Visible but disabled: "coming soon" sports

The sport picker in onboarding shows **"Wrestling 🔒 coming soon"** under
Brazilian Jiu-Jitsu, and Profile's sport picker shows "Wrestling 🔒" with
"Wrestling — coming soon." below it. Both are greyed out, cannot be tapped,
and report themselves as disabled to VoiceOver.

This is a roadmap label, not a dormant feature. Wrestling has no sport context
(`COMING_SOON_SPORTS` in `src/sports/index.ts` is display-only), so nothing
can select it and it can never reach the pipeline. If App Review objects to
it, removing that one array entry removes it from both pickers.

### Build settings, not hidden features

Two settings change how the app behaves. Both are read in
`src/config/env.ts`, both default to `false`, and the `base` build profile in
`eas.json` (which the `testflight` profile extends) sets both to `"false"`.
They are **off in every TestFlight and App Store build**:

- `EXPO_PUBLIC_DEMO_MODE`: canned pipeline results, no backend. For
  prototyping on a developer machine.
- `EXPO_PUBLIC_LOCAL_PIPELINE`: runs transcription and AI in the client with
  developer keys. Local testing only.

> **One gap.** An OTA update takes these values from the publisher's local env
> file, not from `eas.json`. Before `eas update`, check that `.env` and
> `.env.local` do not turn either one on. Guarding this automatically is a
> separate follow-up.

The `FEATURE_*` flags in `src/config/featureFlags.ts` gate nothing: no shipped
code reads them, and because they are not `EXPO_PUBLIC_` variables they cannot
be turned on in a client build. The golf files under `src/sports/golf/` are not
registered, so golf is never shown or selectable.

## Signing in

**Flowlog is invite-only.** Public signup is disabled on the backend, and the
"Flowlog is invite-only" button on login only explains this. App Review
therefore needs a demo account.

- Create it the way testers are created: Supabase dashboard → Authentication →
  Users → Add user → Create new user, with a password and auto-confirm on.
- Enter the email and password in **App Store Connect → the version → App
  Review Information → Sign-In Information**. That is the only place they go.
- **Never put the demo account's email or password in this repo**, in an
  issue, or in a commit message. The repo is public.
- Sign in with it once before each submission to confirm it still works.

A new demo account goes through onboarding and the tour on first sign-in. An
account that has already been onboarded opens on Record.

"Forgot password?" on login sends a reset email, but no screen in the app
handles the emailed link yet (password recovery is not built). App Review should
not need it, as long as the demo account's password is correct.

## Suggested test steps

1. Sign in with the demo account.
2. If onboarding appears: pick Brazilian Jiu-Jitsu, any level, gi or no-gi, and
   allow the microphone. Swipe through the tour.
3. On the Record tab, tap **Record** and speak for 20 to 90 seconds about a
   jiu-jitsu session. Anyone can use this script:

   > "Tonight I rolled five rounds. In closed guard bottom against a heavier
   > partner I kept losing my grips. When I tried a scissor sweep he posted his
   > hand and passed to half guard. My frames were late and my elbows flared
   > out, so he got the underhook and flattened me."

4. Tap **Record** again to stop, then **Submit**.
5. Wait while the processing screen works through its steps.
6. Read the coaching cue on the result screen, then rate it: 👍, or 👎 and pick
   what was off.
7. Tap **View log**, then tap the session to see its detail.

## Notes for Review

Paste this into **App Review Information → Notes**. Update it whenever the
feature table above changes.

```text
Flowlog is a voice reflection app for Brazilian Jiu-Jitsu athletes. After training, the athlete records a 20 to 90 second voice note about the session. Flowlog transcribes it on our server, identifies the positions and mistakes described, and returns one coaching cue of 25 words or fewer. Sessions build into a log and a trends view.

SIGN-IN
Flowlog is invite-only: we create accounts, and the "Flowlog is invite-only" button on the login screen only explains this. Please use the demo account in Sign-In Information. On first sign-in you will see a short onboarding (sport, level, gi or no-gi, microphone permission) and a four-slide tour.

HOW TO TEST
1. On the Record tab, tap Record and allow the microphone if asked.
2. Speak for 20 to 90 seconds about a jiu-jitsu session. For example: "Tonight I rolled five rounds. In closed guard bottom against a heavier partner I kept losing my grips. When I tried a scissor sweep he posted his hand and passed to half guard. My frames were late and my elbows flared out."
3. Tap Record again to stop, then tap Submit.
4. Wait while the processing screen works through its steps.
5. Read the coaching cue, then rate it with thumbs up or thumbs down.
6. Tap View log, then tap the session to open its detail.

EVERY FEATURE AND HOW TO REACH IT
- Record tab: record, play back, re-record, Submit. A streak strip opens the Log.
- Result screen (after Submit): the coaching cue, a summary, cue rating, "Review transcript", Done, View log.
- Log tab: sessions by week, search, and a "Needs review" filter. Tap a session for its transcript, transcript editing and Re-analyze, cue rating, Share and Delete.
- Trends tab: streak, session count, focus area, most-worked positions, recurring mistakes and mood. A lighter view is shown before 10 sessions.
- Profile tab: sport and skill level, training reminders, weekly digest, "View weekly digests", "Replay tour", Change password, Sign out, Delete account.
- Training reminders (off until turned on in Profile): local notifications that open the Record tab.
- Weekly digest (off until turned on in Profile): a weekly local notification that opens that week's summary. Past weeks are under "View weekly digests".
- The sport pickers show "Wrestling" greyed out with a lock and "coming soon". It cannot be selected; it is a roadmap label.

The app has no screens other than these, and no hidden, debug or demo modes in this build.
```

## Before you submit

- [ ] `npm test` is green, so the route inventory matches `app/`.
- [ ] The feature table and the Notes for Review above match the inventory.
- [ ] The demo account signs in, and its credentials are in App Store Connect.
- [ ] Sign in with Apple is configured (guideline 4.8; see `TESTFLIGHT.md` §6).
      Not covered by this doc.
