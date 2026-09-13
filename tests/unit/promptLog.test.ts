import {
  promptLogRows,
  recordAttempts,
  type SentPrompt,
} from '../../src/services/promptLog';

interface Output {
  cue: string;
  sent: SentPrompt;
}

const sent = (prompt: string): SentPrompt => ({
  prompt,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
});

const ids = { sessionId: 's1', runId: 'run1', run: 'insert' as const };

describe('coaching prompt log (#121)', () => {
  it('records every attempt through one path, in order', async () => {
    let n = 0;
    const { coach, attempts } = recordAttempts<Output>(async (strict) => ({
      cue: `cue ${++n}`,
      sent: sent(strict ? `prompt ${n} STRICT` : `prompt ${n}`),
    }));
    await coach(false);
    await coach(true);
    await coach(true);
    expect(attempts.map((a) => [a.strict, a.sent.prompt])).toEqual([
      [false, 'prompt 1'],
      [true, 'prompt 2 STRICT'],
      [true, 'prompt 3 STRICT'],
    ]);
  });

  it('marks only the attempt the gate kept as producing the Cue', async () => {
    const { coach, attempts } = recordAttempts<Output>(async (strict) => ({
      // Same text on both attempts: only identity can tell them apart.
      cue: 'Frame on the hip.',
      sent: sent(strict ? 'strict' : 'first'),
    }));
    await coach(false);
    const kept = await coach(true);

    const rows = promptLogRows(ids, attempts, kept);
    expect(rows.map((r) => [r.attempt, r.strict, r.produced_cue])).toEqual([
      [1, false, false],
      [2, true, true],
    ]);
    expect(rows[1]).toEqual({
      session_id: 's1',
      run_id: 'run1',
      run: 'insert',
      attempt: 2,
      strict: true,
      produced_cue: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      prompt: 'strict',
    });
  });

  it('says no attempt produced a fallback Cue', async () => {
    const { coach, attempts } = recordAttempts<Output>(async () => ({
      cue: 'too generic',
      sent: sent('p'),
    }));
    await coach(false);
    await coach(true);
    await coach(true);
    const rows = promptLogRows({ ...ids, run: 'reanalysis' }, attempts, null);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.produced_cue)).toBe(true);
    expect(rows.every((r) => r.run === 'reanalysis')).toBe(true);
  });

  it('writes nothing when no coaching call was made', () => {
    expect(promptLogRows(ids, [], null)).toEqual([]);
  });
});
