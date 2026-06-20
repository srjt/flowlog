import { getSportContext, registeredSportKeys } from '@/sports';
import type { ISportContext } from '@/sports/ISportContext';
import { BJJ_VOCABULARY_FLAT } from '@/sports/bjj/bjjVocabulary';

/** Validates every registered sport satisfies the ISportContext contract. */
function assertValidContext(ctx: ISportContext) {
  expect(typeof ctx.sportKey).toBe('string');
  expect(ctx.sportKey.length).toBeGreaterThan(0);
  expect(typeof ctx.displayName).toBe('string');
  expect(Array.isArray(ctx.vocabulary)).toBe(true);
  expect(typeof ctx.sessionUnit).toBe('string');
  expect(typeof ctx.extractionPrompt).toBe('string');
  expect(typeof ctx.coachingPrompt).toBe('string');
  expect(Array.isArray(ctx.sentimentLabels)).toBe(true);
  expect(ctx.sentimentLabels.length).toBeGreaterThan(0);
  expect(Array.isArray(ctx.qualityGatePhrases)).toBe(true);
  expect(ctx.minRecordingSeconds).toBeGreaterThan(0);
  expect(ctx.maxRecordingSeconds).toBeGreaterThan(ctx.minRecordingSeconds);
}

describe('sport registry', () => {
  it('registers bjj and golf', () => {
    expect(registeredSportKeys().sort()).toEqual(['bjj', 'golf']);
  });

  it('throws on an unknown sport key', () => {
    expect(() => getSportContext('underwater-basket-weaving')).toThrow(
      /Unknown sport/,
    );
  });

  it.each(registeredSportKeys())(
    'sport "%s" satisfies the ISportContext contract',
    (key) => {
      assertValidContext(getSportContext(key));
    },
  );
});

describe('bjj context', () => {
  it('ships 200+ vocabulary terms for Whisper priming', () => {
    expect(BJJ_VOCABULARY_FLAT.length).toBeGreaterThanOrEqual(200);
  });

  it('uses "roll" as its session unit', () => {
    expect(getSportContext('bjj').sessionUnit).toBe('roll');
  });

  it('has a non-empty generic-phrase blocklist', () => {
    expect(
      getSportContext('bjj').qualityGatePhrases.length,
    ).toBeGreaterThan(0);
  });
});
