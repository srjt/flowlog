# Flowlog — Critical UX & Product Review

*Reviewer lens: mobile UX, behavioral psychology, retention/growth, accessibility — grounded in the actual screen code (`app/`), design system (`src/components/ui/`), and theme (`tailwind.config.js`) as of 2026-06-15. Every claim below maps to a specific file.*

This review is deliberately harsh. The scaffold is clean and the core idea — one spoken reflection, one mechanical cue — is genuinely strong. But as a shippable consumer product the current flow leaks system internals, has no onboarding, no habit loop, and exposes transient pipeline states as permanent navigation. Those are the things that will quietly kill retention.

---

## Executive Summary

| Dimension | Score | One-line verdict |
|---|---|---|
| **Overall UX** | **57 / 100** | Strong core loop undermined by missing onboarding, broken IA, and dev-facing copy. |
| Usability | 60 | The happy path works; error paths and edge cases dead-end the user. |
| Engagement | 45 | No reminders, no surfaced streak, no aha moment. Nothing pulls the user back. |
| Visual Design | 70 | Clean, modern dark theme — but iconless tabs and jargon copy cheapen it. |
| Accessibility | 54 | `accessibilityRole` is present; dynamic type, labels, and state announcements are not. |
| Retention | 40 | The single biggest risk. The product has no mechanism to create a return visit. |

**The one thing to fix first:** there is no onboarding and no post-training reminder. A reflection app that depends on the user remembering to open it within minutes of leaving the mat — with zero nudge — will see catastrophic D1/D7 drop-off no matter how good the cue is.

---

## Top 10 UX Problems (ranked by severity)

| # | Issue | Why it matters / behavioral impact | Recommendation |
|---|---|---|---|
| 1 | **No onboarding or value framing.** `app/index.tsx` redirects straight to a bare login; signup (`signup.tsx`) is email + password only. The user is dropped onto Record with a default sport/skill they never chose. | First-time users have no mental model, no perceived value, and a mislabeled profile. Activation craters. | Add a 3–4 screen onboarding: value prop → pick sport → pick skill level → mic permission priming → guided first recording. |
| 2 | **No retention loop — no reminders/notifications.** Nothing in the codebase schedules a post-session nudge. | A reflection happens in a 10-minute window after training. Without a nudge at that moment of intent, the habit never forms. This is the #1 retention killer. | Local notification ~scheduled around the user's training days/times; "How was training? 60 seconds." |
| 3 | **Transient pipeline states are top-level tabs.** `(tabs)/_layout.tsx` exposes `Processing` and `Result` as tappable tabs. Tapping `Result` cold shows "No result yet." (`output.tsx`); `Processing` cold shows a spinner forever. | Two of six tabs are dead ends on direct tap. Confuses everyone, violates "recognition not recall." | Remove Processing/Output from the tab bar. Make them modal/stack screens in the record flow. Tabs = Record, Log, Trends, Profile. |
| 4 | **Error state on Processing has no recovery.** `processing.tsx` shows "Hmm, that didn't work" + raw `errorMessage`, but **no Retry button and no way back** except tapping another tab. | User who just spoke for 90s hits a wall and loses the recording. High-frustration, high-churn moment. | Add "Try again" (re-invoke pipeline) and "Discard" actions. Never show raw error strings. |
| 5 | **Dev/system jargon leaks into the UI.** `profile.tsx`: "Golf is behind FEATURE_GOLF_SPORT (off in MVP)." `output.tsx`: "fallback cue" and "quality check passed." | Destroys trust and polish. Users should never see flag names or internal pipeline states. | "Golf — coming soon." Drop the quality-gate status from the user view entirely (it's debug telemetry). |
| 6 | **Short recordings proceed anyway.** In `record.tsx`, `finish()` sets a "record at least Ns" hint but still calls `setAudioUri` and pushes to Processing. | Wasted API spend and a guaranteed weak cue, which trains the user that the product is low quality. | Block submission below `minRecordingSeconds`; offer "Keep recording" or "Discard." |
| 7 | **No cancel / re-record / review.** Once recording starts, the only action is finish→process (`record.tsx`). No discard, no playback. | Removes user control & freedom (Nielsen #3). One stumble = a committed bad session. | Add Cancel during recording and a brief review/re-record step before submit. |
| 8 | **Iconless tab bar.** `(tabs)/_layout.tsx` sets tints but no `tabBarIcon` on any `Tabs.Screen`. | Text-only/placeholder tabs look unfinished and slow scanning; fails platform convention (iOS HIG / Material). | Add a clear icon per tab; pair icon + short label. |
| 9 | **Streak & progress are buried.** The streak and "X sessions to unlock" live only inside the Trends tab (`trends.tsx`); the home/Record screen shows none of it. | The strongest habit signal (streak) is hidden from the screen the user sees most. Wasted motivation lever. | Surface streak + progress-to-unlock on the Record screen. |
| 10 | **Flash of wrong empty state on Log/Trends.** Both load async via `useFocusEffect` with no loading state; `trends.tsx` starts `null` → renders "Record a few sessions…" before data resolves. | Returning users briefly see "you have nothing," which reads as data loss. Erodes trust in perceived performance. | Add skeletons; distinguish "loading" from "genuinely empty." |

---

## Quick Wins (1–2 weeks)

| Fix | Effort | Impact | Expected UX gain |
|---|---|---|---|
| Remove Processing/Output from tabs; convert to stack/modal | Low | High | +15% clarity, kills 2 dead-end tabs |
| Replace jargon copy (flag names, "fallback cue", "quality check passed") | Low | Med-High | Trust/polish jump |
| Add Retry + Discard to the Processing error state | Low | High | Recovers the worst churn moment |
| Add tab-bar icons | Low | Med | Looks finished; faster nav |
| Block sub-minimum recordings before submit | Low | Med | Saves cost, raises cue quality |
| Add loading skeletons to Log & Trends | Low | Med | Removes "my data vanished" scare |
| Surface streak on the Record screen | Low | Med-High | Daily motivation where it's seen |

## Medium-Term Improvements (1–2 months)

| Fix | Effort | Impact | Expected UX gain |
|---|---|---|---|
| Full onboarding (value → sport → skill → permission → first record) | Med | Very High | Largest single activation lift |
| Post-training local reminders (configurable to training days) | Med | Very High | The retention loop the app currently lacks |
| Cancel + review/re-record before submit | Med | High | Restores user control |
| Reason capture on 👎 ("too generic / wrong position / not actionable") | Low-Med | Med | Closes feedback loop, improves model + signals care |
| Recording affordance: live waveform/pulse + clear "tap to stop" | Med | Med | Confidence the app is listening |
| Log enhancements: week grouping, filter, search | Med | Med | Makes history usable as a real journal |

## Strategic Improvements (3–6 months)

| Fix | Effort | Impact | Expected UX gain |
|---|---|---|---|
| Progression system around the 10-session unlock (visible goal, milestone celebration) | Med-High | High | Goal-gradient motivation toward first big payoff |
| "Aha" first-result moment: celebrate the first cue, explain the trend payoff to come | Med | High | Converts curiosity into commitment |
| Weekly digest ("this week you worked guard 4×; recurring leak: …") via notification/email | High | High | Re-engagement engine |
| Coach/training-partner share of a session or trend | Med-High | Med | Organic growth loop (BJJ is social) |
| Accessibility pass: dynamic type, screen-reader labels/state, contrast audit | Med | Med-High | Broadens reach, reduces risk |

---

## Screen-by-Screen Review

### Login (`app/(auth)/login.tsx`)
**Works:** Minimal, branded ("Flowlog / Talk. Reflect. Improve."), real Supabase auth, loading + error states present.
**Hurts:** This is the *first thing a new user sees* and it asks them to log in before they know what the app does. No value prop, no screenshots, no "what is this." No social/Apple/Google sign-in (high friction on mobile). No "forgot password."
**Confusing:** "Create an account" is a ghost (low-emphasis) button, so the primary new-user path looks secondary.
**Recommend:** Gate behind a short onboarding carousel. Add OAuth. Make signup visually equal to login for first-timers.

### Signup (`app/(auth)/signup.tsx`)
**Works:** Clean; handles the email-confirmation case with a clear notice.
**Hurts:** Collects nothing useful — no name, no sport, no skill. The user lands in the app already misconfigured (default sport BJJ, first skill level in the list) and must discover Profile to fix it.
**Recommend:** Fold sport + skill selection into the signup/onboarding flow. Show a password-strength/length hint inline rather than only via error.

### Record (`app/(tabs)/record.tsx`)
**Works:** The heart of the app and the best screen — one giant 176px button, sport/skill header, and a nice "Working on: {dominantWeakness}" continuity pill.
**Hurts:** Button is static (just swaps label→timer); no waveform/pulse so it's unclear it's truly recording. No cancel, no review, no re-record. Sub-minimum recordings still submit. Permission denial shows a tiny caption with no path to Settings. Streak/progress absent.
**Recommend:** Live recording animation; Cancel + review; block short clips; deep-link to Settings on denied permission; surface streak.

### Processing (`app/(tabs)/processing.tsx`)
**Works:** Step-by-step progress list is excellent perceived-performance design — better than a bare spinner.
**Hurts:** It's a *tab* (dead end cold). On error: raw error string and **no recovery action**. No time estimate, no cancel.
**Recommend:** De-tab it; add Retry/Discard; humanize errors; show rough ETA.

### Result / Output (`app/(tabs)/output.tsx`)
**Works:** The one cue is the hero — correct hierarchy. Thumbs feedback is a good lightweight signal. Clear "Done" / "View log."
**Hurts:** It's a tab (cold = "No result yet" dead end). Shows internal "fallback cue" / "quality check passed." 👎 captures no reason. No save/share/note. Emoji-as-button is inconsistent with the themed `Button`.
**Recommend:** De-tab; remove quality-gate copy; add 👎 reason chips; add share; first-time celebration.

### Log (`app/(tabs)/log.tsx`)
**Works:** Clean newest-first list; date · sport · cue · mistake is scannable; sensible empty state; refreshes on focus.
**Hurts:** Flat — no grouping, filter, or search; no pull-to-refresh; flash of empty state while loading; streak not echoed here.
**Recommend:** Group by week, add skeleton, add filter/search as history grows.

### Trends (`app/(tabs)/trends.tsx`)
**Works:** Genuinely good content — streak, session count, helpful-rate, focus area, most-worked positions (bar list), recurring mistakes, mood. This is the product's payoff.
**Hurts:** Always-visible even pre-unlock with a "sharpens after 10 sessions" caveat (mixed message); `null`→empty-state flash; the headline value (focus area / recurring leak) isn't pushed anywhere the user routinely looks.
**Recommend:** Show explicit progress toward the 10-session unlock as a goal bar; promote the focus area to Record/notifications.

### Profile (`app/(tabs)/profile.tsx`)
**Works:** Clear sport/skill switchers, account, sign-out; Golf shown locked (🔒).
**Hurts:** Surfaces "FEATURE_GOLF_SPORT (off in MVP)" — pure developer copy. Skill level lives here instead of onboarding. No edit profile, no notification settings, no support/about/delete-account (often store-required).
**Recommend:** Human copy ("Golf — coming soon"); add notification preferences; add account management.

### Session Detail (`app/session/[id].tsx`)
**Works:** Strong detail view — cue, structured breakdown (positions as chips, mistake, opponent, mood), transcript, editable thumbs.
**Hurts:** Custom "‹ Back" text button is a small tap target (~`px-2 py-1`) vs a native header; transcript in muted gray reduces readability of a key artifact; no edit/delete/share.
**Recommend:** Use a proper header with a standard back affordance; raise transcript contrast; add manage/share actions.

---

## Mobile UX Heuristics — Violations

- **Visibility of system status:** Processing error gives no recovery; Log/Trends lack loading states. *(High)*
- **User control & freedom:** No cancel recording, no cancel processing, no re-record, no undo. *(High)*
- **Match system ↔ real world:** "fallback cue," "FEATURE_GOLF_SPORT," "quality check passed" are system language. *(High)*
- **Consistency & standards:** Emoji buttons vs themed `Button`; custom back vs no headers; iconless tabs. *(Med)*
- **Error prevention:** Short clips submit and burn cost/quality. *(Med)*
- **Recognition over recall:** Transient states as tabs; tabs without icons. *(Med)*
- **Help & documentation / onboarding:** None. *(High)*
- **Aesthetic & minimalist design:** Largely respected — a real strength. *(Pass)*

---

## Accessibility Audit

- **Roles:** `accessibilityRole="button"` is consistently applied — good baseline.
- **Labels/state:** Record button has no `accessibilityLabel`/`accessibilityState` for recording vs idle; thumbs buttons are emoji-only with no explicit label. A screen-reader user can't tell recording state or feedback meaning reliably.
- **Dynamic Type:** Fixed Tailwind sizes (`text-3xl`, `text-base`, `text-sm`) won't scale with OS font settings in RN by default — a real exclusion for low-vision users.
- **Contrast:** Muted `#8A8A99` on `#0B0B0F` ≈ **5.8:1** (passes AA for body), and inactive tab `#8A8A99` on `#16161D` ≈ **5.4:1** (pass). Acceptable — but muted gray carries too much *important* info (dates, hints), reading as low-priority.
- **Tap targets:** Record (176px) and thumbs (48px) are great; the "‹ Back" button (~24px tall) is below the 44px minimum.
- **Recommend:** Add labels + state; support dynamic type / allow scaling; promote critical captions out of muted; enlarge back target.

---

## Performance Perception Audit

- **Strength:** Processing step list is the right pattern — users tolerate waits when progress is itemized.
- **Gaps:** No skeletons on Log/Trends → flash of empty/"nothing here" before data loads. No optimistic UI. No ETA on processing. Error states are abrupt.
- **Recommend:** Skeleton rows for Log/Trends; treat "loading" and "empty" as distinct; show approximate processing time; animate state transitions.

---

## Redesigned User Journey (ideal end-to-end)

1. **First open → Onboarding (new).** 3 cards: *what Flowlog does* → *pick your sport* → *pick skill level*. Then prime mic permission with a reason ("so you can talk instead of type"). Optional: account creation deferred until after the first cue (let them feel value first).
2. **Guided first recording.** Coached prompt on the Record screen ("Right after training, tell me: what happened, what felt off?"). Live waveform confirms listening. Cancel available.
3. **Review (new, optional).** Quick "looks good?" with re-record before spending the pipeline call. Block sub-minimum clips here.
4. **Processing (modal, not a tab).** Step list + ETA. On failure: Retry / Discard.
5. **Result (modal).** Hero cue → target → summary. First-time celebration + "this is session 1 of 10 — trends unlock then." 👍/👎 with reason chips on 👎. Save/share.
6. **Home/Record henceforth** shows streak, last focus area, and progress to unlock — the motivation lives where the user lands.
7. **Re-engagement.** A reminder fires around the user's training days: "How was training? 60 seconds." Weekly digest summarizes the recurring leak.
8. **Log/Trends** are the reference layer — grouped, searchable, with the focus area promoted forward.

**Why it's superior:** it (a) delivers perceived value before asking for commitment, (b) protects the costly pipeline call, (c) closes the feedback loop, and most importantly (d) builds an external trigger (reminder) + visible goal (streak/unlock) — the two ingredients the current build is missing for habit formation (cue → routine → reward → investment).

---

## Prioritized Action Plan (impact ÷ effort, fastest value first)

1. **De-tab Processing & Output; add Retry/Discard on error.** *Low effort, high impact.* Removes 2 dead-end tabs and the worst churn moment. **~+12% usability.**
2. **Strip dev jargon; add tab icons.** *Low / med.* Immediate trust + polish. **~+6%.**
3. **Block sub-minimum recordings; add loading skeletons.** *Low / med.* Cost + perceived quality. **~+5%.**
4. **Surface streak + unlock progress on Record.** *Low / med-high.* Puts motivation where it's seen. **~+8% engagement.**
5. **Onboarding flow (value → sport → skill → permission → first record).** *Med / very high.* The biggest activation lever. **~+18% activation.**
6. **Post-training reminders.** *Med / very high.* Creates the return visit the app currently can't. **~+20% D7 retention.**
7. **Cancel/review/re-record + 👎 reason capture.** *Med / high.* Control + signal. **~+7%.**
8. **Accessibility pass (dynamic type, labels, back target).** *Med.* Reach + risk. **~+5%.**

Items 1–4 are a single sprint and should ship before any new feature work. Items 5–6 are where the retention curve actually bends.

---

*Caveat: this is a static review of the codebase, not a live device walkthrough. A short session on a real device (and a 10-user moderated test of the record→result loop) would confirm the friction points around recording feedback and processing latency.*
