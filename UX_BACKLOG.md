# Flowlog — UX Implementation Backlog (Sequenced User Stories)

Each story below is a **self-contained implementation prompt**. Hand them to an engineer or a coding agent **in order** — later stories assume earlier ones are merged. Every story is grounded in the current codebase (`app/`, `src/`) and must respect `CLAUDE.md`.

## Global rules (apply to EVERY story — do not violate)

- **Env only via `src/config/env.ts`.** Never `process.env` directly (ESLint-enforced).
- **No AI/transcription API calls or `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` in client code.** Pipeline work stays server-side; client orchestrates via `src/pipeline/PipelineClient.ts`.
- **Sport-specific copy/logic only in `src/sports/{sportKey}/`.** No sport strings hardcoded in screens.
- **Coaching cue stays hard-capped at 25 words** (do not touch unless the story says so, and then update both `CoachingService.ts` and the prompt).
- **DB schema changes require a new migration** in `supabase/migrations/`.
- **Theme tokens** (use these, never raw hex in screens): `background #0B0B0F`, `surface #16161D`, `primary #5B8DEF`, `accent #F2C14E`, `muted #8A8A99`, `danger #E5484D`, `success #46A758`.
- **Use the design-system primitives** `@/components/ui` (`Text`, `Button`, `Card`) — don't inline raw styled `<Text>`/`<Pressable>` where a primitive exists.
- **Definition of Done for every story:** `npm test` green, `npm run typecheck` clean, `npm run lint` clean, and the new behavior verified in demo mode (`DEMO_MODE`). Add/extend tests where the story has testable logic.

**Sequence overview:** Foundational IA & polish (US-01→05) → trust & quality (US-06→09) → activation & retention (US-10→13) → depth & inclusivity (US-14→18).

---

## US-01 — Remove transient pipeline screens from the tab bar

**As a** user, **I want** the bottom tabs to show only places I can meaningfully navigate to, **so that** I never tap into an empty "Processing" or "No result yet" dead end.

**Why:** `app/(tabs)/_layout.tsx` currently registers `Processing` and `Result` (`output`) as top-level tabs. Tapping them cold shows a perpetual spinner / "No result yet." (`output.tsx`). These are transient flow states, not destinations.

**Files:** `app/(tabs)/_layout.tsx`, `app/(tabs)/processing.tsx`, `app/(tabs)/output.tsx`, `app/(tabs)/record.tsx`. Likely move processing/output to a stack route group (e.g. `app/(flow)/processing.tsx`, `app/(flow)/output.tsx`) or present as `router.push` stack screens outside the tab navigator.

**Implementation details:**
- Tab bar should contain exactly: **Record, Log, Trends, Profile** (in that order).
- Recording flow still routes Record → Processing → Result via `router.push`/`router.replace`, but those screens are NOT tab items.
- Preserve existing auth guard logic in the tabs layout.
- Result's "View log" / "Done" navigation must still land on the correct tab.

**Acceptance criteria:**
- [ ] Bottom tab bar shows 4 tabs only; Processing and Result are not tappable from the tab bar.
- [ ] Recording a session (demo mode) still flows Record → Processing → Result with no regression.
- [ ] Deep-linking/refreshing on a flow screen without a result redirects sensibly (e.g., back to Record) rather than showing a dead end.
- [ ] From Result, "Done" returns to Record tab and "View log" opens Log tab.

**Out of scope:** Visual restyling of the screens (later stories).

---

## US-02 — Add recoverable error handling to Processing

**As a** user whose analysis failed, **I want** a clear, human message and a way to retry or discard, **so that** I don't lose my recording or get stuck.

**Why:** `app/(tabs)/processing.tsx` shows "Hmm, that didn't work" + raw `errorMessage` and provides **no recovery action**. The user must tap another tab, abandoning the session.

**Files:** `app/(tabs)/processing.tsx`, `src/hooks/usePipeline.ts`, `src/store/sessionStore.ts`.

**Implementation details:**
- On `status === 'error'`, render two `Button`s: **"Try again"** (re-invokes the pipeline on the same `audioUri` from `sessionStore` without re-recording) and **"Discard"** (resets session state, routes to Record).
- Replace the raw `errorMessage` surface with a friendly message. Map known failure modes to copy (e.g., network → "Couldn't reach the server. Check your connection."; audio too short/empty → "That recording was too short to analyze."). Keep the raw message only in `logger`, never in UI.
- "Try again" must be idempotent and must not create duplicate sessions.

**Acceptance criteria:**
- [ ] When the pipeline errors, the user sees a friendly message plus "Try again" and "Discard".
- [ ] "Try again" re-runs the pipeline against the existing audio and proceeds to Result on success.
- [ ] "Discard" clears `sessionStore` session state and returns to Record.
- [ ] No raw error string or stack is shown to the user (verify via demo-mode forced error).
- [ ] Unit test: a forced pipeline failure produces an error state with both actions available.

---

## US-03 — Remove developer/system jargon from all user-facing copy

**As a** user, **I want** copy written for me, not for developers, **so that** the app feels trustworthy and finished.

**Why:** Jargon currently leaks: `profile.tsx` → "Golf is behind FEATURE_GOLF_SPORT (off in MVP)."; `output.tsx` → "fallback cue" and "quality check passed"; `processing.tsx` error copy.

**Files:** `app/(tabs)/profile.tsx`, `app/(tabs)/output.tsx`, `app/session/[id].tsx` (audit for similar), any sport copy in `src/sports/`.

**Implementation details:**
- Profile locked-sport copy → e.g. "Golf — coming soon." Remove the flag name entirely.
- Output: remove the quality-gate status string ("quality check passed" / "fallback cue") from the UI. The quality gate is internal telemetry; do not surface it. Keep `qualityGatePassed` in data/logging only.
- Keep "Mood: {sentiment}" but ensure sentiment values render as friendly words (verify the sport context labels).
- Grep the `app/` tree for flag names, "fallback", "quality gate", "MVP", "stub", "TODO" reaching the UI.

**Acceptance criteria:**
- [ ] No feature-flag identifiers, internal pipeline terms, or "MVP/stub" wording appear anywhere in rendered UI.
- [ ] Locked Golf reads as "coming soon" (or similar), no flag name.
- [ ] Output no longer shows quality-gate status to the user; `qualityGatePassed` still exists in the data model and logs.

**Out of scope:** Redesigning the Output layout (US-08 covers feedback changes).

---

## US-04 — Add icons to the bottom tab bar

**As a** user, **I want** recognizable icons on each tab, **so that** navigation is fast and the app looks complete.

**Why:** `app/(tabs)/_layout.tsx` sets tints but defines no `tabBarIcon`, so tabs render label-only/placeholder.

**Files:** `app/(tabs)/_layout.tsx`. Use an icon set already available via Expo (e.g. `@expo/vector-icons` Ionicons/Feather — confirm it's in `package.json`; if not, prefer one already transitively available before adding a dep, and do not bump pinned toolchain versions).

**Implementation details:**
- Add `tabBarIcon` per `Tabs.Screen`: Record (mic), Log (list), Trends (chart/trending-up), Profile (person).
- Use `tabBarActiveTintColor`/`InactiveTintColor` already set (`#5B8DEF` / `#8A8A99`) so icons inherit them.
- Keep labels; icon + short label.

**Acceptance criteria:**
- [ ] Each of the 4 tabs shows a distinct, meaningful icon that tints correctly when active/inactive.
- [ ] No new pinned-dependency version bumps; `expo export`/bundle still succeeds.
- [ ] Icons have appropriate accessibility labels (or labels remain visible).

---

## US-05 — Prevent sub-minimum recordings from being submitted

**As a** user, **I want** the app to stop me before submitting a too-short recording, **so that** I don't waste a turn getting a weak cue.

**Why:** In `app/(tabs)/record.tsx`, `finish()` shows a "record at least Ns" hint but **still** calls `setAudioUri` and pushes to Processing. `PIPELINE_CONFIG.minRecordingSeconds` is the threshold.

**Files:** `app/(tabs)/record.tsx`, `src/constants/pipelineConfig.ts` (read only).

**Implementation details:**
- If `elapsed < minRecordingSeconds`, do NOT proceed to Processing. Instead show inline guidance and offer **"Keep recording"** (resume/continue) and **"Discard"**.
- Applies to both demo and real modes.
- Auto-stop at `maxRecordingSeconds` is unchanged.

**Acceptance criteria:**
- [ ] Finishing below `minRecordingSeconds` does not navigate to Processing and does not call the pipeline.
- [ ] The user is offered to keep recording or discard.
- [ ] A recording ≥ `minRecordingSeconds` proceeds normally.
- [ ] Unit/interaction test covers the short-recording branch.

---

## US-06 — Add Cancel + review/re-record before submit

**As a** user, **I want** to cancel mid-recording and review before submitting, **so that** one stumble doesn't commit a bad session and a costly pipeline call.

**Why:** `record.tsx` offers only finish→process. No cancel, no review, no re-record — a Nielsen "user control & freedom" gap.

**Files:** `app/(tabs)/record.tsx`, `src/store/sessionStore.ts`. (Playback uses `expo-av` `Audio.Sound`; gate playback to non-demo since demo uses a stub URI.)

**Implementation details:**
- During recording, add a **Cancel** affordance that stops and discards the audio (no navigation), returning to idle.
- After finishing a valid-length recording, show a lightweight **review step** (on Record screen or a modal): duration, **Play** (real mode), **Re-record**, **Submit**. Only **Submit** advances to Processing.
- Ensure `expo-av` recordings are unloaded on cancel to avoid leaks.

**Acceptance criteria:**
- [ ] Cancel during recording discards audio and returns to idle with no pipeline call.
- [ ] After a valid recording, the user can play (real mode), re-record, or submit before processing starts.
- [ ] Re-record cleanly resets and starts a fresh capture.
- [ ] No audio resource leaks (recording/sound objects unloaded on discard).

---

## US-07 — Live recording affordance (waveform/pulse + clear stop)

**As a** user, **I want** clear visual confirmation the app is listening, **so that** I trust it's capturing my reflection.

**Why:** The record button is static (label→timer only). No "is it actually recording?" feedback.

**Files:** `app/(tabs)/record.tsx`. Use `react-native-reanimated@~3.10.1` (already pinned — do NOT bump) for a pulse; optionally a simple animated bar/level if metering is available, else a pulse ring.

**Implementation details:**
- While recording: animated pulse/ring around the button + visible elapsed timer + "Tap to stop" label.
- Idle: "Record" with the existing "Working on: {dominantWeakness}" pill.
- Keep animations lightweight; respect reduced-motion (see US-17 a11y) — fall back to a static state if reduced motion is on.

**Acceptance criteria:**
- [ ] Recording state shows a clear animated indicator + timer + stop affordance.
- [ ] Animation uses the pinned Reanimated version; bundle still builds.
- [ ] Reduced-motion users get a non-animated but still clear recording indicator.

---

## US-08 — Capture a reason on thumbs-down feedback

**As a** user who marks a cue unhelpful, **I want** to say *why* in one tap, **so that** the product improves and I feel heard.

**Why:** `output.tsx` and `session/[id].tsx` capture only a boolean thumb. The "why" signal — the most useful — is lost.

**Files:** `app/(tabs)/output.tsx`, `app/session/[id].tsx`, `src/services/sessionsSource.ts` (`saveSessionFeedback`), `src/store/sessionStore.ts`, `src/types/session.ts`, plus a **new migration** in `supabase/migrations/` for a `feedback_reason` column.

**Implementation details:**
- On 👎, reveal reason chips: e.g. "Too generic", "Wrong position", "Not actionable", "Already knew it". Multi-select or single — pick single for v1.
- Extend `saveSessionFeedback(sessionId, up, reason?)` and the session type with `feedbackReason?: string | null`.
- Add the DB column via migration; keep backward compatibility (nullable).
- 👍 path unchanged (no reason required).

**Acceptance criteria:**
- [ ] Selecting 👎 reveals reason chips; choosing one persists `feedbackReason`.
- [ ] 👍 still works with no reason.
- [ ] New nullable column added via a migration file; no breaking change to existing rows.
- [ ] Feedback (and reason) round-trips: set in Output, visible/editable in Session Detail.
- [ ] Tests cover the extended `saveSessionFeedback` signature.

---

## US-09 — Loading skeletons + true empty-vs-loading states (Log & Trends)

**As a** returning user, **I want** to see a loading state instead of a "you have nothing" flash, **so that** I don't think my data vanished.

**Why:** `log.tsx` and `trends.tsx` load async via `useFocusEffect` with no loading indicator; `trends.tsx` starts `null` and renders "Record a few sessions…" before data resolves.

**Files:** `app/(tabs)/log.tsx`, `app/(tabs)/trends.tsx`. Add a reusable `Skeleton` to `src/components/ui/` and export from `src/components/ui/index.ts`.

**Implementation details:**
- Introduce a 3-state model: `loading` | `empty` | `loaded`. Distinguish "still loading" from "loaded and genuinely empty."
- Show skeleton rows/cards while loading; show the empty-state card only after load completes with zero items.
- Add pull-to-refresh to Log's `FlatList`.

**Acceptance criteria:**
- [ ] Log and Trends show skeletons while loading, not the empty-state copy.
- [ ] The "no sessions yet" / "record a few sessions" copy appears only after a confirmed empty load.
- [ ] Log supports pull-to-refresh.
- [ ] No regression to the focus-effect refresh behavior.

---

## US-10 — Surface streak + unlock progress on the Record screen

**As a** user opening the app, **I want** to see my streak and progress toward unlocking trends, **so that** I'm motivated to record today.

**Why:** Streak and the "10 sessions to unlock" goal live only inside `trends.tsx`. The strongest habit signal is hidden from the screen the user sees most.

**Files:** `app/(tabs)/record.tsx`, `src/services/TrendsService.ts` (reuse `computeTrends`/streak), `src/hooks/` (consider a small `useStreak`/`useProgress` hook), `src/config/featureFlags.ts` (`SESSIONS_TO_UNLOCK`).

**Implementation details:**
- On Record (idle state), show a compact strip: current **day streak**, **session count**, and **progress to unlock** (e.g. "3 of 10 sessions — trends unlock at 10") using a thin progress bar consistent with Trends' `BarList` styling.
- Load lazily; don't block the record button render. Use skeleton/placeholder while loading (reuse US-09 `Skeleton`).
- Hide gracefully for brand-new users (0 sessions) — show an encouraging first-session prompt instead.

**Acceptance criteria:**
- [ ] Idle Record screen shows streak + progress-to-unlock derived from real session history.
- [ ] New users (0 sessions) see an encouraging prompt, not an empty/zero strip.
- [ ] Values match what Trends computes (single source of truth in `TrendsService`).
- [ ] No layout jank or delay to the record button.

---

## US-11 — First-session onboarding flow

**As a** first-time user, **I want** a short intro that explains the app and sets up my sport, skill, and mic, **so that** I understand the value and my profile is correct before I record.

**Why:** `app/index.tsx` redirects straight to login; `signup.tsx` collects only email/password; the user lands on Record with a default sport (BJJ) and the first skill level in the list — never chosen. No value framing, no permission priming.

**Files:** new `app/(onboarding)/` route group (e.g. `welcome.tsx`, `sport.tsx`, `skill.tsx`, `permission.tsx`), `app/index.tsx` (routing logic), `app/_layout.tsx`, `src/store/userStore.ts` (persist an `onboardingComplete` flag), `src/services/AuthService.ts` (persist sport/skill to profile), `src/sports/` (sport list + skill levels — already there via `registeredSportKeys()` / `getSportContext`).

**Implementation details:**
- Flow: **Value cards** (what Flowlog does: talk → reflect → one cue) → **pick sport** (from `registeredSportKeys()`, respecting enabled/locked like Profile) → **pick skill level** (`getSportContext(key).skillLevels`) → **mic permission priming** screen explaining *why* before the OS prompt.
- Persist sport + skill to the user store and profile (reuse Profile's setters/`AuthService.getProfile`).
- Gate: show onboarding only when not completed; route completed users straight to Record. Respect demo/local auto-sign-in.
- Consider deferring account creation until after the first cue is shown (let users feel value first) — if low-risk, route: onboarding → first guided record → result → prompt to save account. If that's too large, keep account-first but make signup collect sport/skill. Pick one and document it in the PR.

**Acceptance criteria:**
- [ ] A new user sees value framing, selects sport, selects skill level, and is primed before the mic permission prompt.
- [ ] Selected sport + skill persist to the user store and profile and are reflected on Record/Profile.
- [ ] Returning/onboarded users skip onboarding.
- [ ] Locked sports (e.g. Golf) are shown but not selectable, consistent with Profile rules.
- [ ] Demo/local modes still auto-enter without breaking.

---

## US-12 — Post-training reminder notifications

**As a** user, **I want** a gentle reminder to reflect around my training times, **so that** I actually record while it's fresh and build the habit.

**Why:** Nothing in the codebase schedules a return trigger. A reflection app with no external trigger cannot form a habit — the single biggest retention gap.

**Files:** new notification service (e.g. `src/services/NotificationService.ts`) using `expo-notifications` (add dep without bumping pinned `metro`/`nativewind`/`reanimated`; verify SDK 51 compatibility), `app/(tabs)/profile.tsx` (reminder preferences UI), `src/store/userStore.ts` (persist reminder prefs), permission priming screen. Update `CLAUDE.md` "What's built" if appropriate.

**Implementation details:**
- Let the user pick training days + a reminder time (e.g. "Mon/Wed/Fri at 8:30pm") in Profile.
- Schedule local notifications accordingly; copy like "How was training? 60 seconds to reflect." Tapping opens Record.
- Request notification permission with a priming explanation (not cold).
- Handle reschedule/cancel when prefs change; no duplicate schedules.
- Respect platform constraints; no server push required for v1 (local notifications only).

**Acceptance criteria:**
- [ ] User can enable reminders, choose days + time, and disable them in Profile.
- [ ] Permission is requested with a priming rationale before the OS prompt.
- [ ] Scheduled notification deep-links into the Record screen on tap.
- [ ] Changing prefs reschedules cleanly with no duplicates.
- [ ] Works without server-side push; no API keys in client.

---

## US-13 — First-result celebration + visible progression to first unlock

**As a** new user seeing my first cue, **I want** a moment of delight and a clear sense of the journey ahead, **so that** curiosity converts into commitment.

**Why:** The "one cue" is a strong reward but there's no celebration on first result, no goal-gradient toward the 10-session unlock.

**Files:** `app/(tabs)/output.tsx` (or `app/(flow)/output.tsx` after US-01), `src/store/sessionStore.ts`/`TrendsService.ts` (session count), `src/config/featureFlags.ts` (`SESSIONS_TO_UNLOCK`).

**Implementation details:**
- On the user's **first** result, show a one-time celebratory treatment (subtle animation/confetti or highlighted card) + a line explaining trends unlock at 10 sessions.
- On subsequent results, show lightweight progress ("session 4 of 10 — trends unlock at 10").
- One-time states must be idempotent/persisted so they don't replay.
- Respect reduced-motion.

**Acceptance criteria:**
- [ ] First-ever result shows a distinct celebration; it does not repeat on later sessions.
- [ ] Each result shows progress toward the unlock until reached.
- [ ] Reduced-motion users get a non-animated equivalent.

---

## US-14 — Log enhancements: week grouping, search, and filter

**As a** user with history, **I want** to group, search, and filter my log, **so that** it works as a real training journal.

**Why:** `log.tsx` is a flat newest-first list — no grouping, search, or filter. The product positions itself as a "trend log."

**Files:** `app/(tabs)/log.tsx`, `src/services/sessionsSource.ts` (read), possibly a small grouping helper in `src/utils/`.

**Implementation details:**
- Group sessions by week (section headers) using `SectionList`, newest first.
- Add a search field (matches cue / key mistake / position text).
- Add a simple filter (e.g. by sport when multiple are active, and/or "needs review" = 👎/no feedback).
- Preserve tap-through to `session/[id]` and focus-refresh behavior.

**Acceptance criteria:**
- [ ] Log is grouped by week with clear headers.
- [ ] Search narrows the list by cue/mistake/position.
- [ ] At least one useful filter is available and works.
- [ ] No regression to navigation or refresh-on-focus.

---

## US-15 — Session Detail: native header, readable transcript, manage/share

**As a** user reviewing a past session, **I want** a standard header and a readable transcript with management actions, **so that** the detail screen feels native and useful.

**Why:** `app/session/[id].tsx` uses a tiny custom "‹ Back" (~`px-2 py-1`, below 44px), renders the transcript in low-contrast `muted`, and offers no edit/delete/share.

**Files:** `app/session/[id].tsx`, `app/_layout.tsx` (Stack screen options for a header), `src/services/sessionsSource.ts` (delete support → may need a migration/RPC if hard-deleting).

**Implementation details:**
- Use a proper stack header with a standard back control (≥44px target) instead of the custom text button.
- Raise transcript readability (use body/white, not muted).
- Add a context menu / actions: **Share** (cue + summary as text), **Delete session** (with confirm). If delete touches the DB, add the appropriate migration/policy.

**Acceptance criteria:**
- [ ] Detail screen has a native header with a standard, ≥44px back affordance.
- [ ] Transcript is rendered at readable contrast.
- [ ] Share produces a sensible text snippet; Delete removes the session (with confirmation) and updates Log/Trends.
- [ ] Any DB delete is covered by a migration/policy and respects RLS.

---

## US-16 — Login improvements: OAuth + forgot password + balanced CTAs

**As a** new or returning user, **I want** fast sign-in options and password recovery, **so that** I'm not blocked at the door.

**Why:** `login.tsx` is email/password only, "Create an account" is a low-emphasis ghost button, and there's no "forgot password."

**Files:** `app/(auth)/login.tsx`, `app/(auth)/signup.tsx`, `src/services/AuthService.ts`, `src/lib/supabase.ts`. Use Supabase Auth providers (Apple/Google) — keep all secrets server/config side; only `EXPO_PUBLIC_*` reach the client.

**Implementation details:**
- Add Apple + Google sign-in via Supabase (Apple is effectively required for iOS App Store if other social logins exist).
- Add "Forgot password?" → Supabase reset email flow.
- For first-time users, make the signup CTA visually equal to login.
- Inline password length hint on signup (min 6) rather than only on error.

**Acceptance criteria:**
- [ ] At least one OAuth provider works end-to-end via Supabase (no client secrets).
- [ ] "Forgot password" triggers the reset flow with user feedback.
- [ ] Signup CTA is visually prominent for new users.
- [ ] No `OPENAI/ANTHROPIC` or non-`EXPO_PUBLIC` secrets in client.

---

## US-17 — Accessibility pass (dynamic type, labels, state, reduced motion, tap targets)

**As a** user relying on assistive tech or larger text, **I want** the app to adapt, **so that** I can use it fully.

**Why:** `accessibilityRole` is present but labels/state are not; fixed Tailwind sizes don't scale with OS text; emoji buttons lack labels; reduced motion isn't handled; some targets (<44px) are small.

**Files:** `src/components/ui/Text.tsx` (allow OS font scaling), all screens for labels/state, `record.tsx` (recording state announcement), `output.tsx`/`session/[id].tsx` (thumbs labels), any animation from US-07/US-13 (reduced motion).

**Implementation details:**
- Ensure text respects OS Dynamic Type (don't force `allowFontScaling={false}`; verify layouts tolerate larger text).
- Add `accessibilityLabel` to icon/emoji-only controls (thumbs → "Mark cue helpful"/"Mark cue unhelpful"); add `accessibilityState` for the record button (recording vs idle) and selected chips.
- Honor reduced-motion (`AccessibilityInfo.isReduceMotionEnabled`) for US-07/US-13 animations.
- Ensure all interactive targets ≥44×44 (fix the back button if US-15 didn't).
- Promote critical captions out of `muted` where they carry primary info (dates/hints).

**Acceptance criteria:**
- [ ] VoiceOver/TalkBack announces meaningful labels for all controls, including record state and thumbs.
- [ ] Larger OS text sizes don't break layouts or clip content.
- [ ] Reduced-motion disables non-essential animation.
- [ ] No interactive target below 44×44.

---

## US-18 — Weekly digest (re-engagement)

**As a** user, **I want** a weekly summary of what I worked on and my recurring leak, **so that** I get value even on weeks I forget to open the app — and a reason to come back.

**Why:** Re-engagement engine. Builds on the streak/reminder infra (US-12) and existing `TrendsService` aggregation.

**Files:** `src/services/TrendsService.ts` (reuse aggregation), `src/services/NotificationService.ts` (from US-12) for a scheduled weekly local notification; optional server-side digest (email) is a later extension and must follow the edge-function/secrets rules.

**Implementation details:**
- v1: a weekly local notification summarizing top focus area + recurring mistake (e.g. "This week: most-worked = Guard; recurring leak = hand placement"). Tapping opens Trends.
- Compute from local session history via `computeTrends`; respect the same active-sport scoping as Trends.
- Email digest (optional, future): generate server-side in an edge function — never call providers from the client.

**Acceptance criteria:**
- [ ] A weekly notification summarizing focus area + recurring mistake fires on a configurable day/time.
- [ ] Tapping it opens Trends for the active sport.
- [ ] Summary values match `TrendsService` output.
- [ ] Any email path (if built) runs server-side with no client secrets.

---

## Suggested execution order (dependencies)

```
US-01 → US-02 → US-03 → US-04 → US-05 → US-06 → US-07 → US-08 → US-09
      → US-10 (needs TrendsService streak)         → US-11 (onboarding)
      → US-12 (reminders; needs permission priming from US-11)
      → US-13 (needs US-01 output route)           → US-14 → US-15
      → US-16 → US-17 (depends on US-07/US-13 animations) → US-18 (needs US-12)
```

Ship **US-01→US-05** as the first sprint (highest impact ÷ effort, zero new infra). **US-11 + US-12** are where retention bends and should be the next milestone.
