/**
 * Map a raw pipeline error to a short, human message for the UI. The raw error
 * is only ever logged (see usePipeline) — never shown to the user. Keep the copy
 * actionable and non-technical.
 */
export function toFriendlyMessage(error: unknown): string {
  const raw = (
    error instanceof Error ? error.message : String(error ?? '')
  ).toLowerCase();

  if (/network|failed to fetch|could ?n.?t reach|econn|timeout|timed out/.test(raw)) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  if (/too short|empty transcript|no audio|produced no audio/.test(raw)) {
    return 'That recording was too short to analyze. Try a longer reflection.';
  }
  if (/unauthor|signed in|sign in|\b401\b|forbidden|\b403\b/.test(raw)) {
    return 'You’re signed out. Please log in and try again.';
  }
  if (/download audio|upload|bucket|storage/.test(raw)) {
    return 'We couldn’t handle that recording. Please try again.';
  }
  if (
    /api key|quota|\b429\b|invalid[_ ]argument|malformed json|no text content|\bmodel\b/.test(
      raw,
    )
  ) {
    return 'The analysis service hiccuped. Tap Try again in a moment.';
  }
  return 'Something went wrong analyzing your session. Tap Try again.';
}
