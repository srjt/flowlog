import {
  latestRun,
  type SessionPromptRecord,
} from '../../scripts/admin/review';

const rec = (o: Partial<SessionPromptRecord> = {}): SessionPromptRecord => ({
  run_id: 'run1',
  run: 'insert',
  attempt: 1,
  strict: false,
  produced_cue: false,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  prompt: 'prompt',
  created_at: '2026-09-13T10:00:00.000Z',
  ...o,
});

describe('cue review: the prompt the model received (#121)', () => {
  it('has nothing to show for a session generated before logging', () => {
    expect(latestRun([])).toBeNull();
  });

  it('finds the attempt that produced the Cue, attempts in order', () => {
    const run = latestRun([
      rec({ attempt: 2, strict: true, produced_cue: true }),
      rec({ attempt: 1 }),
    ]);
    expect(run?.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(run?.produced?.attempt).toBe(2);
    expect(run).toMatchObject({ run: 'insert', runs: 1 });
  });

  it('describes the latest run, since re-analysis overwrote the Cue', () => {
    const run = latestRun([
      rec({ run_id: 'first', attempt: 1, produced_cue: true }),
      rec({
        run_id: 'second',
        run: 'reanalysis',
        attempt: 1,
        produced_cue: true,
        prompt: 'corrected',
        created_at: '2026-09-14T09:00:00.000Z',
      }),
    ]);
    expect(run).toMatchObject({ run: 'reanalysis', runs: 2 });
    expect(run?.attempts).toHaveLength(1);
    expect(run?.produced?.prompt).toBe('corrected');
  });

  it('reports no producing attempt when the gate fell back', () => {
    const run = latestRun([
      rec({ attempt: 1 }),
      rec({ attempt: 2, strict: true }),
      rec({ attempt: 3, strict: true }),
    ]);
    expect(run?.produced).toBeNull();
    expect(run?.attempts).toHaveLength(3);
  });
});
