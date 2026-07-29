# 0011. Correct transcripts after the cue, not before

**Status:** accepted · **Date:** 2026-07-28 · Supersedes the pre-analysis
editable transcript review (introduced build `a2e7548`).

We had added an editable transcript review screen that ran **before** analysis,
so a mis-heard word could be fixed before it corrupted the coaching cue. In
practice the correction was almost never used, yet it gated **every** cue behind
a second server round-trip and a mandatory read-and-edit step — and the sport
**vocabulary priming** already mitigates most mis-hears. We now show the cue
immediately (a single `process-session` call) and make correction an opt-in,
post-hoc action: from Output or Session detail the user edits the saved
Session's transcript and **re-analyzes**, which re-runs extraction → coaching →
quality gate on the edited text and **updates the same Session row in place**
(`pipeline_version` bumped). See the **Re-analyze** entry in `CONTEXT.md`.

## Consequences

- The pre-cue path is deleted: the transcript review screen, `useTranscribe`,
  `PipelineClient.transcribeAudio`, the server's `stopAfterTranscription`
  branch, and the `isTranscriptReview` flag + Record's routing fork. Record goes
  straight to Processing again.
- `process-session` gains a **reprocess mode**: given an existing `sessionId` +
  `editedTranscript`, it verifies ownership via JWT, re-runs the AI stages, and
  UPDATEs the row — bypassing the insert-time idempotency and daily-cap checks
  (a reprocess is not a new Session). No schema migration: only existing columns
  are overwritten, and RLS "Users own their sessions" already scopes the update.
- One reflection stays one Session, so trends, streak, and the daily cap are
  unaffected. The prior cue is overwritten — no version history is kept.

## Considered options

- **Keep the review as-is** — rejected: rarely used, yet always costs a step and
  a round-trip before the cue.
- **Confidence-gated review** (show it only on low transcription confidence) —
  rejected: still gates some cues before the result and adds a threshold to tune.
- **Remove correction entirely** — rejected: loses the safety valve for genuine
  mis-hears, and you cannot re-say the exact same reflection to try again.
