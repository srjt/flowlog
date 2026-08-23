import {
  candidatePositions,
  groundingSection,
  rankRecords,
  type GroundableExtraction,
  type GroundableRecord,
} from '@/sports/grounding';

function rec(over: Partial<GroundableRecord> = {}): GroundableRecord {
  return {
    prescription: 'Frame on the far hip before he settles.',
    why: 'Once the crossface lands the frame has nowhere to go.',
    detail: 'Forearm across the hip.',
    counter: '',
    gi: 'either',
    level: 'any',
    opponent: '',
    ...over,
  };
}

function extraction(
  over: Partial<GroundableExtraction> = {},
): GroundableExtraction {
  return {
    positionsVisited: ['Side Control'],
    keyMistake: 'Let him settle his chest before framing.',
    opponentAction: 'Held a strong crossface.',
    perspective: 'bottom',
    rawTranscript: 'He passed and settled into side control on me.',
    ...over,
  };
}

describe('candidatePositions', () => {
  it('resolves every mentioned position, not just one', () => {
    // The mistake concerns one of them; ranking settles which. Choosing up
    // front would have to guess, and a wrong guess grounds the wrong situation.
    const ids = candidatePositions(
      extraction({ positionsVisited: ['Side Control', 'Half Guard'] }),
    );
    expect(ids).toEqual(
      expect.arrayContaining(['side-control-bottom', 'half-guard-bottom']),
    );
  });

  it('respects perspective — a bottom session never asks for top records', () => {
    expect(candidatePositions(extraction({ perspective: 'top' }))).toEqual([
      'side-control-top',
    ]);
  });

  it('returns nothing when the side is unknown', () => {
    const ids = candidatePositions(
      extraction({
        perspective: 'unknown',
        keyMistake: 'lost position',
        opponentAction: '',
      }),
    );
    expect(ids).toEqual([]);
  });

  it('ignores submissions and concepts the extractor puts in the position field', () => {
    expect(
      candidatePositions(
        extraction({ positionsVisited: ['Kimura', 'Berimbolo'] }),
      ),
    ).toEqual([]);
  });

  it('de-duplicates when several names map to the same position', () => {
    const ids = candidatePositions(
      extraction({ positionsVisited: ['Side Control', 'side control'] }),
    );
    expect(ids).toEqual(['side-control-bottom']);
  });
});

describe('rankRecords', () => {
  it('puts records that share vocabulary with the mistake first', () => {
    const relevant = rec({
      prescription: 'Frame early against the crossface.',
    });
    const other = rec({
      prescription: 'Attack the far armbar from mount.',
      why: '',
      detail: '',
    });
    const ranked = rankRecords(
      [other, relevant],
      'Could not frame before the crossface',
    );
    expect(ranked[0]).toBe(relevant);
  });

  it('caps the number injected — dilution is the constraint, not cost', () => {
    const many = Array.from({ length: 145 }, () => rec());
    expect(rankRecords(many, 'framing').length).toBe(20);
  });

  it('is stable for tied scores, so the prompt does not churn', () => {
    const a = rec({ prescription: 'A' });
    const b = rec({ prescription: 'B' });
    expect(rankRecords([a, b], 'nothing matches here')).toEqual(
      rankRecords([a, b], 'nothing matches here'),
    );
  });

  it('still returns records when the mistake has no usable terms', () => {
    expect(rankRecords([rec(), rec()], '').length).toBe(2);
  });

  it('is not fooled by words common to every extracted mistake', () => {
    // "practitioner" and "opponent" appear in almost every keyMistake; if they
    // scored, ranking would be noise.
    const generic = rec({ prescription: 'The practitioner and the opponent.' });
    const real = rec({
      prescription: 'Bridge to displace, never straight up.',
    });
    const ranked = rankRecords(
      [generic, real],
      'The practitioner could not bridge against the opponent',
    );
    expect(ranked[0]).toBe(real);
  });
});

describe('groundingSection', () => {
  it('is empty when ungrounded, so the prompt collapses to what it was', () => {
    expect(groundingSection([])).toBe('');
  });

  it('includes the mechanics and the reasoning', () => {
    const out = groundingSection([rec()]);
    expect(out).toMatch(/REFERENCE MECHANICS/);
    expect(out).toMatch(/Frame on the far hip/);
    expect(out).toMatch(/Why: Once the crossface/);
  });

  it('surfaces preconditions so the model can honour them', () => {
    const out = groundingSection([
      rec({ gi: 'gi', level: 'beginner', opponent: 'chest to chest' }),
    ]);
    expect(out).toMatch(/Applies when: gi, beginner, chest to chest/);
  });

  it('omits preconditions that carry no information', () => {
    // Match the emitted line specifically — the usage guidance also mentions
    // "Applies when", so a looser pattern would match the instructions.
    expect(groundingSection([rec()])).not.toMatch(/Applies when:/);
  });

  it('carries the usage guidance only when there are records to use', () => {
    // Keeping the guidance inside this block is what makes an ungrounded
    // prompt byte-identical to the one the 47% baseline was measured on.
    expect(groundingSection([rec()])).toMatch(/USING THE REFERENCE MECHANICS/);
    expect(groundingSection([])).toBe('');
  });

  it('never names a source', () => {
    const out = groundingSection([rec()]);
    expect(out).not.toMatch(/danaher|instructional|volume|gff/i);
  });
});

describe('candidatePositions — the transcript is load-bearing', () => {
  // A real session resolved to half-guard-bottom for STORAGE and to nothing for
  // GROUNDING, because grounding withheld the transcript. The cue shipped
  // ungrounded while target_position_id looked correct.
  const base = {
    positionsVisited: ['Half Guard'],
    keyMistake:
      'The practitioner was unable to execute a sweep from half guard.',
    opponentAction: "The opponent's defense prevented the sweep.",
    rawTranscript:
      'I was playing half guard from the bottom and kept trying to sweep him.',
    perspective: 'unknown' as const,
  };

  it('recovers the side from the transcript when the summary drops it', () => {
    expect(candidatePositions(base)).toEqual(['half-guard-bottom']);
  });

  it('finds nothing when there is no transcript and no reported side', () => {
    expect(candidatePositions({ ...base, rawTranscript: '' })).toEqual([]);
  });

  it('still prefers the side extraction reported over the transcript', () => {
    // The explicit signal wins; the transcript is the fallback.
    expect(
      candidatePositions({
        ...base,
        rawTranscript: 'I was on top passing his half guard.',
        perspective: 'bottom',
      }),
    ).toEqual(['half-guard-bottom']);
  });
});
