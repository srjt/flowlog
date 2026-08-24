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

  it('caps the number injected even when many are relevant', () => {
    // Every one of these shares "crossface" and "frame" with the mistake, so
    // all clear the relevance gate — the cap is what stops 145 reaching the model.
    const many = Array.from({ length: 145 }, () => rec());
    expect(
      rankRecords(many, 'Could not frame before the crossface landed').length,
    ).toBe(20);
  });

  it('is stable for tied scores, so the prompt does not churn', () => {
    const a = rec({ prescription: 'A' });
    const b = rec({ prescription: 'B' });
    expect(rankRecords([a, b], 'nothing matches here')).toEqual(
      rankRecords([a, b], 'nothing matches here'),
    );
  });

  it('grounds NOTHING when the mistake gives nothing to match on', () => {
    // With no terms we cannot tell a relevant record from an irrelevant one,
    // and injecting arbitrary records for the position is what made cues worse.
    expect(rankRecords([rec(), rec()], '')).toEqual([]);
  });

  it('is not fooled by words common to every extracted mistake', () => {
    // "practitioner" and "opponent" appear in almost every keyMistake. If they
    // scored, they alone would carry an unrelated record past the relevance
    // gate — which is precisely how off-topic mechanics reached the model.
    const generic = rec({
      prescription: 'The practitioner and the opponent.',
      why: '',
      detail: '',
    });
    const onTopic = rec({
      prescription: 'Bridge to displace them, never straight up.',
      why: 'Bridging vertically does not move their centre of gravity.',
      detail: '',
    });
    const ranked = rankRecords(
      [generic, onTopic],
      'The practitioner could not bridge to displace the opponent',
    );
    expect(ranked).toEqual([onTopic]);
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
    expect(groundingSection([rec()])).toMatch(/THE MISTAKE IS THE JOB/);
    expect(groundingSection([])).toBe('');
  });

  it('gives explicit permission to ignore the records', () => {
    // Without this the model builds a confident cue around whichever mechanic
    // it was handed, even when none address the mistake — the failure a blind
    // trial caught, where the grounded cue lost two-to-one.
    expect(groundingSection([rec()])).toMatch(/IGNORE THEM ALL/);
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

describe('rankRecords — the relevance gate', () => {
  const about = (text: string): GroundableRecord => ({
    prescription: text,
    why: '',
    detail: '',
    counter: '',
    gi: 'either',
    level: 'any',
    opponent: '',
  });

  it('drops records about the right position but the wrong problem', () => {
    // A blind trial found injecting these made cues WORSE: the model builds a
    // specific cue around a mechanic that answers a different question.
    const relevant = about('Frame against the crossface before it settles.');
    const offTopic = about('Attack the far armbar once you have mount.');
    const out = rankRecords(
      [offTopic, relevant],
      'Could not frame against the crossface in time',
    );
    expect(out).toEqual([relevant]);
  });

  it('grounds nothing when no record clears the bar', () => {
    // "Ungrounded" is a correct outcome, not a fallback failure.
    const out = rankRecords(
      [about('Attack the far armbar once you have mount.')],
      'Could not frame against the crossface in time',
    );
    expect(out).toEqual([]);
  });

  it('requires more than a single incidental word in common', () => {
    const oneWord = about('Keep your frame strong in every position.');
    expect(
      rankRecords([oneWord], 'Could not frame against the crossface'),
    ).toEqual([]);
  });

  it('honours an explicit threshold', () => {
    const r = about('Frame against the crossface before it settles.');
    expect(rankRecords([r], 'frame crossface', 20, 3)).toEqual([]);
    expect(rankRecords([r], 'frame crossface', 20, 2)).toEqual([r]);
  });
});

describe('groundingSection structure (#71)', () => {
  const record = (prescription: string) => ({
    prescription,
    why: 'Because the frame has nowhere to go once the crossface lands.',
    detail: 'Forearm across the hip.',
    counter: '',
    gi: 'either',
    level: 'any',
    opponent: '',
  });

  const section = groundingSection([
    record('Frame on the far hip before he settles.'),
    record('Turn to your side early.'),
  ]);

  it('emits the REFERENCE MECHANICS header exactly once', () => {
    // It used to appear twice, with the records under the first and the
    // guidance under the second — heading an empty section.
    expect(section.match(/REFERENCE MECHANICS/g)).toHaveLength(1);
  });

  it('puts the discard guidance BEFORE the records it refers to', () => {
    // The guidance says "the mechanics below" and "for each one". Those were
    // false while the records sat above it, which orphaned the single most
    // important instruction in the block.
    const guidance = section.indexOf('THE MISTAKE IS THE JOB');
    const records = section.indexOf('Frame on the far hip');
    expect(guidance).toBeGreaterThanOrEqual(0);
    expect(records).toBeGreaterThan(guidance);
  });

  it('keeps the discard instruction attached to a non-empty list', () => {
    const ignore = section.indexOf('IF NONE OF THEM FIT');
    expect(ignore).toBeGreaterThanOrEqual(0);
    expect(section.indexOf('Turn to your side early.')).toBeGreaterThan(ignore);
  });

  it('separates the guidance bullets from the record bullets', () => {
    // Both are bullet lists; without a boundary the records read as more
    // instructions to follow rather than notes to weigh and discard.
    const boundary = section.indexOf('THE MECHANICS:');
    expect(boundary).toBeGreaterThan(
      section.indexOf('Never mention these notes'),
    );
    expect(section.indexOf('Frame on the far hip')).toBeGreaterThan(boundary);
  });

  it('still collapses to nothing when ungrounded', () => {
    // An ungrounded cue must be indistinguishable from one produced before
    // grounding existed.
    expect(groundingSection([])).toBe('');
  });
});
