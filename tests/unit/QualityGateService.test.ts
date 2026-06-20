import { QualityGateService } from '@/services/QualityGateService';
import { getSportContext } from '@/sports';
import type { CoachingOutput } from '@/types/pipeline';

const bjj = getSportContext('bjj');

function coaching(overrides: Partial<CoachingOutput> = {}): CoachingOutput {
  return {
    cue: 'From turtle, pin one wrist and drive your shoulder into their hip before standing.',
    targetPosition: 'Turtle',
    confidenceScore: 0.8,
    isGeneric: false,
    ...overrides,
  };
}

describe('QualityGateService.evaluate', () => {
  const gate = new QualityGateService();

  it('passes a specific, confident, in-length cue', () => {
    expect(gate.evaluate(coaching(), bjj).passed).toBe(true);
  });

  it('rejects a cue over the 25-word cap', () => {
    const longCue = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const result = gate.evaluate(coaching({ cue: longCue }), bjj);
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toMatch(/word cap/);
  });

  it('rejects an empty cue', () => {
    expect(gate.evaluate(coaching({ cue: '   ' }), bjj).passed).toBe(false);
  });

  it('rejects when the model flags the cue generic', () => {
    expect(gate.evaluate(coaching({ isGeneric: true }), bjj).passed).toBe(
      false,
    );
  });

  it('rejects confidence below 0.6', () => {
    const result = gate.evaluate(coaching({ confidenceScore: 0.4 }), bjj);
    expect(result.passed).toBe(false);
    expect(result.failureReasons.join(' ')).toMatch(/confidence/);
  });

  // Every phrase in the sport blocklist must be caught.
  it.each(bjj.qualityGatePhrases)(
    'rejects cue containing generic phrase: "%s"',
    (phrase) => {
      const result = gate.evaluate(coaching({ cue: `Honestly, ${phrase}.` }), bjj);
      expect(result.passed).toBe(false);
      expect(result.failureReasons.join(' ').toLowerCase()).toContain('generic');
    },
  );
});

describe('QualityGateService.enforce', () => {
  it('returns the first cue when it already passes (no retries)', async () => {
    const gate = new QualityGateService();
    const good = coaching();
    let regenCalls = 0;
    const result = await gate.enforce(good, bjj, async () => {
      regenCalls++;
      return good;
    });
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(regenCalls).toBe(0);
    expect(result.usedFallback).toBe(false);
  });

  it('retries with strict prompt and accepts a fixed cue', async () => {
    const gate = new QualityGateService();
    const bad = coaching({ isGeneric: true, confidenceScore: 0.3 });
    const fixed = coaching();
    const result = await gate.enforce(bad, bjj, async (strict) => {
      expect(strict).toBe(true);
      return fixed;
    });
    expect(result.passed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns a safe fallback when every retry fails, never throwing', async () => {
    const gate = new QualityGateService();
    const bad = coaching({ isGeneric: true });
    const result = await gate.enforce(bad, bjj, async () => bad);
    expect(result.passed).toBe(false);
    expect(result.usedFallback).toBe(true);
    // Fallback cue must itself respect the word cap.
    expect(
      result.coaching.cue.trim().split(/\s+/).length,
    ).toBeLessThanOrEqual(25);
    // 1 initial + QUALITY_GATE_RETRY_LIMIT (2) retries.
    expect(result.attempts).toBe(3);
  });
});
