import { classifyError, toFriendlyMessage } from '@/utils/friendlyError';

describe('toFriendlyMessage', () => {
  it('maps network failures', () => {
    expect(
      toFriendlyMessage(new Error('Claude request failed: network error.')),
    ).toMatch(/connection/i);
  });

  it('maps too-short / empty recordings', () => {
    expect(toFriendlyMessage(new Error('Recording too short: 5s'))).toMatch(
      /too short/i,
    );
    expect(
      toFriendlyMessage(new Error('Gemini returned an empty transcript.')),
    ).toMatch(/too short/i);
  });

  it('maps auth failures', () => {
    expect(toFriendlyMessage(new Error('Unauthorized'))).toMatch(/log in/i);
  });

  it('maps provider/model hiccups', () => {
    expect(
      toFriendlyMessage(new Error('Gemini failed: 429 quota exceeded')),
    ).toMatch(/try again/i);
  });

  it('maps the daily rate limit to its own message, not the generic 429 one', () => {
    expect(
      toFriendlyMessage(
        new Error('Daily limit reached: up to 15 sessions per day.'),
      ),
    ).toMatch(/today.s session limit/i);
  });

  it('keeps plain 429/quota errors on the hiccup message (branch ordering)', () => {
    expect(
      toFriendlyMessage(new Error('Whisper failed: 429 rate limited')),
    ).toMatch(/hiccuped/i);
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(toFriendlyMessage(new Error('weird internal thing'))).toMatch(
      /something went wrong/i,
    );
  });

  it('never leaks the raw technical message', () => {
    const raw =
      'DB insert failed: 500 {"code":"23503","detail":"stacktrace at index.ts:42"}';
    const friendly = toFriendlyMessage(new Error(raw));
    expect(friendly).not.toContain('23503');
    expect(friendly).not.toContain('stacktrace');
    expect(friendly).not.toContain('index.ts');
    expect(friendly).not.toContain('500');
  });

  it('handles non-Error inputs safely', () => {
    expect(typeof toFriendlyMessage('boom')).toBe('string');
    expect(typeof toFriendlyMessage(null)).toBe('string');
    expect(typeof toFriendlyMessage(undefined)).toBe('string');
  });
});

describe('toFriendlyMessage — hard provider stops vs transient hiccups', () => {
  // Retrying cannot clear a spend cap, so the copy must not invite a retry.
  const hardStops = [
    'Gemini API 429: Your project has exceeded its monthly spending cap.',
    'RESOURCE_EXHAUSTED',
    'Gemini failed: 400 API key not valid. Please pass a valid API key.',
    'billing account is not configured',
    'You exceeded your current quota, please check your plan and billing details',
    'PERMISSION_DENIED',
  ];

  it.each(hardStops)('does not tell the user to retry: %s', (msg) => {
    const out = toFriendlyMessage(new Error(msg));
    expect(out).toMatch(/unavailable/i);
    expect(out).not.toMatch(/tap try again in a moment/i);
  });

  it('still treats an ordinary rate limit as retryable', () => {
    expect(
      toFriendlyMessage(new Error('Gemini failed: 429 Too Many Requests')),
    ).toMatch(/try again in a moment/i);
  });

  it('still treats a malformed provider response as retryable', () => {
    expect(
      toFriendlyMessage(new Error('Claude returned malformed JSON')),
    ).toMatch(/try again in a moment/i);
  });

  it('keeps the daily session limit ahead of both', () => {
    expect(toFriendlyMessage(new Error('daily limit reached (429)'))).toMatch(
      /today’s session limit/i,
    );
  });
});

describe('classifyError', () => {
  it('marks a spend cap as not retryable', () => {
    const out = classifyError(
      new Error(
        'Gemini API 429: Your project has exceeded its monthly spending cap.',
      ),
    );
    expect(out.retryable).toBe(false);
    expect(out.message).toMatch(/unavailable/i);
  });

  it('marks an ordinary rate limit as retryable', () => {
    expect(
      classifyError(new Error('Gemini failed: 429 Too Many Requests'))
        .retryable,
    ).toBe(true);
  });

  it('marks network trouble as retryable', () => {
    expect(classifyError(new Error('network error')).retryable).toBe(true);
  });

  it('marks an unknown failure as retryable — retrying is the safe default', () => {
    expect(classifyError(new Error('something odd')).retryable).toBe(true);
  });
});
