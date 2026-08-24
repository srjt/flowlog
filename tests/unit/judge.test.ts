import {
  judgeCue,
  normaliseStatus,
  parseJson,
} from '../../scripts/judge/judge';
import { checkSufficiency } from '../../scripts/judge/sufficiency';
import type { ClaimCheck } from '../../scripts/judge/types';
import {
  formatScore,
  judgeFromClaims,
  scoreJudge,
  type ScoreInput,
} from '../../scripts/judge/verdict';

const record = (prescription: string, why = '') => ({
  prescription,
  why,
  detail: '',
  counter: '',
  gi: 'either',
  level: 'any',
  opponent: '',
});

const check = (status: ClaimCheck['status'], claim = 'c'): ClaimCheck => ({
  claim,
  status,
  reason: `because ${status}`,
});

describe('sufficiency gate', () => {
  const mistake = 'Could not frame before the crossface landed.';

  it('abstains when the position has no records at all', () => {
    const r = checkSufficiency([], mistake);
    expect(r.sufficient).toBe(false);
    expect(r.reason).toMatch(/no records/);
  });

  it('abstains when there is no mistake to rank relevance against', () => {
    // Ranking against the cue instead would be circular: it would retrieve
    // whatever the cue talks about, then praise the cue for matching it.
    const r = checkSufficiency(
      [record('Frame on the far hip before the crossface.')],
      '',
    );
    expect(r.sufficient).toBe(false);
    expect(r.reason).toMatch(/no key mistake/);
  });

  it('abstains when too few records are actually relevant', () => {
    const r = checkSufficiency(
      [record('Grip the collar and break their posture.')],
      mistake,
    );
    expect(r.sufficient).toBe(false);
    expect(r.reason).toMatch(/need/);
  });

  it('passes once enough relevant records survive ranking', () => {
    const r = checkSufficiency(
      [
        record('Frame on the hip before the crossface lands.'),
        record('Keep the crossface off with an early frame.'),
        record('Turn to your side before the crossface settles.'),
        record('Something about standing takedowns entirely.'),
      ],
      mistake,
    );
    expect(r.sufficient).toBe(true);
    // The irrelevant record does not reach the judge.
    expect(r.records.length).toBeGreaterThanOrEqual(3);
    expect(r.records.some((x) => x.prescription.includes('takedowns'))).toBe(
      false,
    );
  });
});

describe('judgeFromClaims', () => {
  it('condemns a cue with a contradicted claim, whatever else it got right', () => {
    const r = judgeFromClaims([check('supported'), check('contradicted')]);
    expect(r.defective).toBe(true);
    expect(r.rationale).toMatch(/contradicted/);
  });

  it('condemns a cue where nothing addresses the mistake', () => {
    // Half the defects in the frozen set are this: sound jiu-jitsu, aimed
    // elsewhere. A check that only asked "is this correct?" passes them all.
    const r = judgeFromClaims([check('off_target'), check('off_target')]);
    expect(r.defective).toBe(true);
    expect(r.rationale).toMatch(/nothing addresses/);
  });

  it('passes a cue with at least one supported claim', () => {
    expect(
      judgeFromClaims([check('off_target'), check('supported')]).defective,
    ).toBe(false);
  });

  it('does not condemn for unsupported claims alone', () => {
    // The corpus is one instructional series. Absence of a mechanic from it is
    // a coverage gap, not evidence against the mechanic.
    const r = judgeFromClaims([check('unsupported'), check('unsupported')]);
    expect(r.defective).toBe(false);
  });

  it('condemns a cue that made no checkable instruction', () => {
    expect(judgeFromClaims([]).defective).toBe(true);
  });
});

describe('normaliseStatus', () => {
  it.each(['supported', 'contradicted', 'off_target', 'unsupported'])(
    'keeps %s',
    (s) => expect(normaliseStatus(s)).toBe(s),
  );

  it.each([undefined, null, '', 'WRONG', 42, {}])(
    'turns unrecognised %p into unsupported, never contradicted',
    (v) => {
      // A judge that converts its own parse failures into accusations posts
      // recall it has not earned.
      expect(normaliseStatus(v)).toBe('unsupported');
    },
  );
});

describe('parseJson', () => {
  it('reads plain JSON', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads fenced JSON', () => {
    expect(parseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers JSON embedded in prose', () => {
    expect(parseJson<{ a: number }>('Sure! {"a":1} hope that helps')).toEqual({
      a: 1,
    });
  });

  it('returns null rather than throwing on junk', () => {
    expect(parseJson('not json at all')).toBeNull();
  });
});

describe('scoreJudge', () => {
  function rows(spec: [ScoreInput['human'], boolean][]): ScoreInput[] {
    return spec.map(([human, defective], i) => ({
      sessionId: `s${i}`,
      human,
      defective,
    }));
  }

  it('passes when recall clears the bar and false positives stay under the ceiling', () => {
    const s = scoreJudge(
      rows([
        ...(Array(12).fill(['wrong', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(5).fill(['wrong', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(2).fill(['sound', true]) as [ScoreInput['human'], boolean][]),
        ...(Array(9).fill(['sound', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
      ]),
    );
    expect(s).toMatchObject({
      caught: 12,
      defects: 17,
      falsePositives: 2,
      passed: true,
    });
  });

  it('fails on recall even when it never condemns a sound cue', () => {
    const s = scoreJudge(
      rows([
        ...(Array(11).fill(['wrong', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(6).fill(['wrong', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(11).fill(['sound', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
      ]),
    );
    expect(s.passed).toBe(false);
    expect(s.failures[0]).toMatch(/recall/);
  });

  it('fails the degenerate judge that condemns everything', () => {
    // The set is 47% wrong, so flagging everything scores 47% "accuracy" while
    // being completely blind. The ceiling is what kills it.
    const s = scoreJudge(
      rows([
        ...(Array(17).fill(['wrong', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(11).fill(['sound', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
      ]),
    );
    expect(s.caught).toBe(17);
    expect(s.passed).toBe(false);
    expect(s.failures[0]).toMatch(/false positives/);
  });

  it('counts shallow cues without ever scoring them', () => {
    // The sound/shallow line is subjective; demanding the judge reproduce it
    // would fail a judge that is good at what matters.
    const s = scoreJudge(
      rows([
        ...(Array(12).fill(['wrong', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(5).fill(['wrong', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(11).fill(['sound', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(8).fill(['shallow', true]) as [
          ScoreInput['human'],
          boolean,
        ][]),
      ]),
    );
    expect(s.shallowFlagged).toBe(8);
    expect(s.passed).toBe(true);
  });

  it('reports every failed criterion, not just the first', () => {
    const s = scoreJudge(
      rows([
        ...(Array(3).fill(['wrong', true]) as [ScoreInput['human'], boolean][]),
        ...(Array(14).fill(['wrong', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
        ...(Array(5).fill(['sound', true]) as [ScoreInput['human'], boolean][]),
        ...(Array(6).fill(['sound', false]) as [
          ScoreInput['human'],
          boolean,
        ][]),
      ]),
    );
    expect(s.failures).toHaveLength(2);
  });
});

describe('judgeCue', () => {
  const subject = {
    sessionId: 's1',
    cue: 'Secure an underhook, then drive your hips forward.',
    target: 'Half Guard Passing',
    keyMistake: 'Failed to clear the knee shield.',
  };

  function fakeModel(claims: string[], statuses: string[]) {
    let call = 0;
    return async (_prompt: string) => {
      if (call++ === 0) return JSON.stringify({ claims });
      const status = statuses[call - 2] ?? 'unsupported';
      return JSON.stringify({ status, reason: 'r' });
    };
  }

  it('decomposes, checks each claim separately, and reports the mode', async () => {
    const complete = jest.fn(
      fakeModel(
        ['Secure an underhook.', 'Drive your hips forward.'],
        ['contradicted', 'off_target'],
      ),
    );

    const j = await judgeCue(subject, [], complete);

    // One decomposition call plus one per claim — never a batch, which would
    // let the model grade holistically and back-fill the parts.
    expect(complete).toHaveBeenCalledTimes(3);
    expect(j.mode).toBe('ungrounded');
    expect(j.claims.map((c) => c.status)).toEqual([
      'contradicted',
      'off_target',
    ]);
    expect(j.defective).toBe(true);
  });

  it('runs grounded once the gate is satisfied', async () => {
    const records = [
      record('Frame on the knee shield before you step past.'),
      record('Clear the knee shield with a hip switch, not a hip drive.'),
      record('Kill the knee shield by pinning the far knee first.'),
    ];
    const complete = jest.fn(
      fakeModel(['Drive your hips forward.'], ['contradicted']),
    );

    const j = await judgeCue(
      { ...subject, keyMistake: 'Failed to clear the knee shield.' },
      records,
      complete,
    );

    expect(j.mode).toBe('grounded');
    expect(j.recordsAvailable).toBeGreaterThanOrEqual(3);
  });

  it('treats an unparseable check as unsupported rather than a defect', async () => {
    const complete = async (p: string) =>
      p.includes('decomposing')
        ? JSON.stringify({ claims: ['A claim.'] })
        : 'garbage';

    const j = await judgeCue(subject, [], complete);

    expect(j.claims[0]?.status).toBe('unsupported');
    expect(j.defective).toBe(false);
  });

  it('condemns a cue it could not decompose into any instruction', async () => {
    const j = await judgeCue(subject, [], async () =>
      JSON.stringify({ claims: [] }),
    );
    expect(j.defective).toBe(true);
    expect(j.claims).toEqual([]);
  });
});

describe('formatScore', () => {
  it('says PASS or FAIL outright, so nobody has to eyeball it', () => {
    const pass = formatScore(
      {
        caught: 12,
        defects: 17,
        falsePositives: 1,
        sound: 11,
        shallowFlagged: 3,
        shallow: 8,
        passed: true,
        failures: [],
      },
      [],
    );
    expect(pass).toMatch(/RESULT: PASS/);

    const fail = formatScore(
      {
        caught: 4,
        defects: 17,
        falsePositives: 0,
        sound: 11,
        shallowFlagged: 0,
        shallow: 8,
        passed: false,
        failures: ['recall: caught 4/17'],
      },
      [],
    );
    expect(fail).toMatch(/RESULT: FAIL/);
    expect(fail).toMatch(/recall: caught 4\/17/);
  });
});
