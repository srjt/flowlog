/**
 * The cue-trust report in the local review tool: "do I trust the cues it gives
 * me?", read from the operator's own verdicts against a target and the #36
 * baseline. It's a pure function over the session list, so it's tested here
 * with no server and no database.
 */
import {
  CUE_WORD_CAP,
  FROZEN_BASELINE,
  GATE_FALLBACK,
  REASON_POINTS_AT,
  TRUST_TARGET,
  WRONG_REASONS,
  cueWords,
  cueWriter,
  trustReport,
  type CueVerdict,
  type PromptAttempt,
  type SessionSummary,
  type WrongReason,
} from '../../scripts/admin/review';

function summary(
  day: number,
  verdict: CueVerdict | null,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  const date = `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  return {
    id: `s${String(day).padStart(2, '0')}`,
    userId: 'u1',
    athlete: 'Ana',
    sessionDate: date,
    cue: 'Frame on the far hip before the shoulder pressure settles.',
    keyMistake: 'got flattened',
    transcript: null,
    targetPositionId: 'half-guard-bottom',
    targetPositionLabel: 'Half guard (bottom)',
    grounding: 'grounded',
    gatePassed: true,
    thumbsUp: null,
    feedbackReason: null,
    trail: 'trusted',
    reanalyzed: false,
    verdict,
    verdictReason: verdict === 'wrong' ? 'model_wrong' : null,
    earlierVerdicts: 0,
    cueWriter: 'pro-model',
    ai: [],
    aiHidden: 0,
    ...extra,
  };
}

const wrong = (day: number, reason: WrongReason, extra = {}) =>
  summary(day, 'wrong', { verdictReason: reason, ...extra });

describe('cueWriter: who wrote the Cue a row holds now', () => {
  const attempt = (o: Partial<PromptAttempt>): PromptAttempt => ({
    run_id: 'r1',
    run: 'insert',
    attempt: 1,
    produced_cue: false,
    model: 'pro-model',
    created_at: '2026-10-01T00:00:00Z',
    ...o,
  });

  it('is null for a Session that predates the prompt log', () => {
    expect(cueWriter([])).toBeNull();
  });

  it('is the model of the attempt that produced the Cue', () => {
    expect(
      cueWriter([
        attempt({ attempt: 1 }),
        attempt({ attempt: 2, produced_cue: true, model: 'fallback-model' }),
      ]),
    ).toBe('fallback-model');
  });

  it('reads the LATEST run: a Re-analyze replaced the Cue', () => {
    expect(
      cueWriter([
        attempt({ produced_cue: true, model: 'old-model' }),
        attempt({
          run_id: 'r2',
          run: 'reanalysis',
          produced_cue: true,
          model: 'pro-model',
          created_at: '2026-10-05T00:00:00Z',
        }),
      ]),
    ).toBe('pro-model');
  });

  it('names the quality-gate fallback when no attempt produced the Cue', () => {
    expect(cueWriter([attempt({}), attempt({ attempt: 2 })])).toBe(
      GATE_FALLBACK,
    );
  });
});

describe('trustReport', () => {
  it('needs a full window before it says met or not met', () => {
    const r = trustReport([summary(1, 'sound'), summary(2, 'wrong')]);
    expect(r.status).toBe('too_few');
    expect(r.recent).toMatchObject({ judged: 2, sound: 1, wrong: 1 });
    expect(r.recent.wrongShare).toBe(0.5);
  });

  it('is met at the limit and not met just past it', () => {
    const target = { window: 10, maxWrongShare: 0.2 };
    const twoWrong = [
      ...Array.from({ length: 8 }, (_, i) => summary(i + 1, 'sound')),
      summary(9, 'wrong'),
      summary(10, 'wrong'),
    ];
    expect(trustReport(twoWrong, target).status).toBe('met');

    const threeWrong = [...twoWrong.slice(1), summary(11, 'wrong')];
    expect(trustReport(threeWrong, target).status).toBe('not_met');
  });

  it('reads only the most recent window, so old cues fall out', () => {
    const target = { window: 3, maxWrongShare: 0 };
    const sessions = [
      summary(1, 'wrong'),
      summary(2, 'wrong'),
      summary(3, 'sound'),
      summary(4, 'sound'),
      summary(5, 'sound'),
    ];
    const r = trustReport(sessions, target);
    expect(r.status).toBe('met');
    expect(r.recent.from).toBe(sessions[2]?.sessionDate);
    expect(r.recent.to).toBe(sessions[4]?.sessionDate);
  });

  it('ignores unjudged Sessions, declined Takes and verdicts on earlier Cues', () => {
    const r = trustReport([
      summary(1, null),
      summary(2, null, { cue: null }), // a declined Take: nothing to judge
      summary(3, null, { earlierVerdicts: 1 }), // judged an older Cue only
      summary(4, 'sound'),
    ]);
    expect(r.recent.judged).toBe(1);
    // The two Sessions holding a Cue with no verdict on it are the queue.
    expect(r.unjudged).toBe(2);
  });

  it('ranks why the wrong ones are wrong, within the window', () => {
    const r = trustReport([
      wrong(1, 'off_target'),
      wrong(2, 'transcript_misheard'),
      wrong(3, 'off_target'),
      summary(4, 'sound'),
    ]);
    expect(r.reasons).toEqual([
      { reason: 'off_target', count: 2 },
      { reason: 'transcript_misheard', count: 1 },
    ]);
  });

  it('splits every judged Cue by the model that wrote it', () => {
    const r = trustReport([
      summary(1, 'sound', { cueWriter: 'pro-model' }),
      summary(2, 'wrong', { cueWriter: 'pro-model' }),
      summary(3, 'wrong', { cueWriter: 'fallback-model' }),
      summary(4, 'shallow', { cueWriter: null }),
    ]);
    expect(r.byWriter).toEqual([
      { writer: 'pro-model', judged: 2, sound: 1, shallow: 0, wrong: 1 },
      { writer: 'fallback-model', judged: 1, sound: 0, shallow: 0, wrong: 1 },
      { writer: null, judged: 1, sound: 0, shallow: 1, wrong: 0 },
    ]);
  });

  it('measures cue length against the cap, for #137', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
    const r = trustReport([
      summary(1, 'sound', { cue: words(14) }),
      summary(2, 'sound', { cue: words(22) }),
      summary(3, 'sound', { cue: words(25) }),
    ]);
    expect(r.length).toEqual({ median: 22, max: 25, nearCap: 2 });
    expect(trustReport([]).length).toBeNull();
  });

  it('counts words the way the cap does', () => {
    expect(cueWords('  Stop reaching.  Pull your knees in ')).toBe(6);
  });
});

describe('the trust constants', () => {
  it('keeps the frozen #36 baseline exactly: 47% wrong of 36', () => {
    const b = FROZEN_BASELINE;
    expect(b.sound + b.shallow + b.wrong).toBe(b.judged);
    expect(Math.round((100 * b.wrong) / b.judged)).toBe(47);
  });

  it('defaults to at most 1 in 5 wrong over the last 20', () => {
    expect(TRUST_TARGET).toEqual({ window: 20, maxWrongShare: 0.2 });
  });

  it('matches the 25-word hard cap', () => {
    expect(CUE_WORD_CAP).toBe(25);
  });

  it('says where every wrong reason points, so the next fix follows evidence', () => {
    for (const reason of WRONG_REASONS) {
      expect(REASON_POINTS_AT[reason]).toBeTruthy();
    }
  });
});
