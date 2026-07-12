import { toFriendlyMessage } from '@/utils/friendlyError';

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
