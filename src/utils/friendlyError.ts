/**
 * A classified pipeline failure: what to tell the user, and whether the retry
 * control should be offered at all.
 *
 * `retryable: false` means tapping again cannot possibly help — a spend cap, a
 * rejected key. Offering a prominent "Try again" there is worse than useless:
 * it invites the user to tap forever while hiding the only true signal, that
 * waiting is pointless.
 */
export interface ClassifiedError {
  message: string;
  retryable: boolean;
}

/** Classify a raw pipeline error. `toFriendlyMessage` is the message half. */
export function classifyError(error: unknown): ClassifiedError {
  const message = toFriendlyMessage(error);
  return { message, retryable: message !== HARD_STOP_MESSAGE };
}

const HARD_STOP_MESSAGE =
  'Analysis is unavailable right now. This isn’t something retrying will fix — please try again later.';

/**
 * Map a raw pipeline error to a short, human message for the UI. The raw error
 * is only ever logged (see usePipeline) — never shown to the user. Keep the copy
 * actionable and non-technical.
 */
export function toFriendlyMessage(error: unknown): string {
  const raw = (
    error instanceof Error ? error.message : String(error ?? '')
  ).toLowerCase();

  if (
    /network|failed to fetch|could ?n.?t reach|econn|timeout|timed out/.test(
      raw,
    )
  ) {
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
  // Must precede the generic 429/quota branch below, which also matches the
  // rate limiter's HTTP status.
  if (/daily limit/.test(raw)) {
    return 'You’ve hit today’s session limit. Your next reflection will be ready tomorrow.';
  }
  // A HARD stop on the analysis provider: a spend cap, an exhausted quota, a
  // rejected key. Retrying cannot clear any of these — only the operator can.
  // Must precede the transient branch below, which also matches 429.
  //
  // This distinction is not theoretical: a Gemini spend cap once surfaced as
  // "hiccuped, tap Try again in a moment", so every retry failed identically
  // and the only honest signal — that waiting was pointless — was the one
  // thing the message hid.
  if (
    /spend(ing)? cap|resource[_ ]exhausted|billing|exceeded your current quota|quota exceeded|api[_ ]?key not valid|invalid api key|api key expired|permission[_ ]denied/.test(
      raw,
    )
  ) {
    return HARD_STOP_MESSAGE;
  }
  // Transient provider trouble: a rate limit, a malformed response, a blip.
  // Retrying genuinely can work here.
  if (
    /api key|quota|\b429\b|invalid[_ ]argument|malformed json|no text content|\bmodel\b/.test(
      raw,
    )
  ) {
    return 'The analysis service hiccuped. Tap Try again in a moment.';
  }
  return 'Something went wrong analyzing your session. Tap Try again.';
}
