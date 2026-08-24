import {
  explicitGiStatement,
  filterByGiContext,
  resolveGiContext,
} from '@/sports/giContext';

const rec = (gi: string) => ({ gi, id: gi });

describe('explicitGiStatement', () => {
  it.each([
    ['we did no-gi today', 'no-gi'],
    ['no gi class this morning', 'no-gi'],
    ['nogi rounds were rough', 'no-gi'],
    ['just rash guard and shorts', 'no-gi'],
    ['it was a gi class', 'gi'],
    ['training in the gi tonight', 'gi'],
    ['forgot my kimono', 'gi'],
  ])('reads %j as %s', (text, expected) => {
    expect(explicitGiStatement(text)).toBe(expected);
  });

  it.each([
    'he got a deep collar grip and I could not strip it',
    'my sleeve grip kept slipping',
    'lapel guard is still confusing to me',
    'I need to work on my grips',
    'rolled for an hour, felt good',
  ])('ignores incidental technique talk: %j', (text) => {
    // Grip words describe what happened, not what was worn. Treating them as a
    // declaration is exactly the surprise the two-signal guard prevents.
    expect(explicitGiStatement(text)).toBeNull();
  });

  it('abstains when the session was both rather than picking one', () => {
    expect(explicitGiStatement('gi class then no-gi rounds after')).toBeNull();
  });

  it('does not read the "gi" inside "no-gi" as a gi statement', () => {
    expect(explicitGiStatement('no-gi class today')).toBe('no-gi');
  });
});

describe('resolveGiContext', () => {
  it('honours the toggle when the recording says nothing', () => {
    expect(
      resolveGiContext({
        toggle: 'gi',
        stated: null,
        transcript: 'got swept from half guard twice',
      }),
    ).toEqual({ gi: 'gi', source: 'toggle', overrode: false });
  });

  it('lets an explicit statement override a stale toggle', () => {
    expect(
      resolveGiContext({
        toggle: 'gi',
        stated: 'no-gi',
        transcript: 'no-gi class today, got my back taken',
      }),
    ).toEqual({ gi: 'no-gi', source: 'transcript', overrode: true });
  });

  it('does not flag an override when the statement agrees with the toggle', () => {
    const r = resolveGiContext({
      toggle: 'no-gi',
      stated: 'no-gi',
      transcript: 'no-gi rounds tonight',
    });
    expect(r.gi).toBe('no-gi');
    expect(r.overrode).toBe(false);
  });

  it('keeps the toggle when the model claims a context the transcript never states', () => {
    // Models fill fields they are given. An unconfirmed claim must not flip
    // the context out from under the athlete.
    expect(
      resolveGiContext({
        toggle: 'gi',
        stated: 'no-gi',
        transcript: 'he kept getting an underhook and running me over',
      }),
    ).toEqual({ gi: 'gi', source: 'toggle', overrode: false });
  });

  it('keeps the toggle when the model and the transcript disagree', () => {
    expect(
      resolveGiContext({
        toggle: 'gi',
        stated: 'gi',
        transcript: 'no-gi class today',
      }).gi,
    ).toBe('gi');
  });

  it('reports no signal at all rather than inventing one', () => {
    expect(
      resolveGiContext({
        toggle: null,
        stated: null,
        transcript: 'rolled five rounds',
      }),
    ).toEqual({ gi: null, source: 'none', overrode: false });
  });

  it('uses an explicit statement even with no toggle, without calling it an override', () => {
    const r = resolveGiContext({
      toggle: null,
      stated: 'no-gi',
      transcript: 'no-gi open mat',
    });
    expect(r).toEqual({ gi: 'no-gi', source: 'transcript', overrode: false });
  });
});

describe('filterByGiContext', () => {
  const records = [rec('gi'), rec('no-gi'), rec('either')];

  it('drops no-gi records from a gi session', () => {
    expect(filterByGiContext(records, 'gi').map((r) => r.gi)).toEqual([
      'gi',
      'either',
    ]);
  });

  it('drops gi records from a no-gi session — no lapel advice in a rash guard', () => {
    expect(filterByGiContext(records, 'no-gi').map((r) => r.gi)).toEqual([
      'no-gi',
      'either',
    ]);
  });

  it('excludes every gi-specific record when the context is unknown', () => {
    // Excluding costs depth, which the athlete can recover with the toggle.
    // Including risks a grip that does not exist in the room, which they cannot.
    expect(filterByGiContext(records, null).map((r) => r.gi)).toEqual([
      'either',
    ]);
  });

  it('keeps records with an unset precondition', () => {
    expect(filterByGiContext([rec('')], null)).toHaveLength(1);
  });

  it('preserves input order, so the ranked prompt stays stable', () => {
    const many = [rec('either'), rec('gi'), rec('either'), rec('gi')];
    expect(filterByGiContext(many, 'gi')).toEqual(many);
  });
});
