import {
  assignIds,
  chapterCoverage,
  isUnscopedAbsolute,
  validateRecords,
  type MinedRecord,
} from '../../scripts/mining/records';
import { applyCorrections } from '../../scripts/mining/prompt';
import {
  chapterAt,
  chaptersForVolume,
  parseChapterIndex,
  parseTranscript,
} from '../../scripts/mining/transcript';

describe('parseTranscript', () => {
  it('reads whisper.cpp timestamps into seconds', () => {
    const out = parseTranscript(
      '[0:06:24.930 -> 0:06:27.930]  I take my elbow and lock over his knee.',
    );
    expect(out).toEqual([
      { startSeconds: 384, text: 'I take my elbow and lock over his knee.' },
    ]);
  });

  it('keeps untimestamped continuation lines instead of dropping them', () => {
    // Losing content silently would defeat the point of mining.
    const out = parseTranscript(
      ['[0:00:01.000 -> 0:00:03.000] first part', 'continued here'].join('\n'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe('first part continued here');
  });

  it('ignores blank lines', () => {
    expect(parseTranscript('\n\n  \n')).toEqual([]);
  });
});

describe('parseChapterIndex', () => {
  const index = [
    'VOLUME 1',
    '',
    '00:00 - Introduction',
    '06:56 - Escapes Overview',
    '01:01:46 - Minimal Escapes',
    '',
    'VOLUME 2',
    '',
    '00:00 - Bridging Escape From Mounted Position (UPA)',
    '30:01 - Elbow Escape From Mounted Position',
  ].join('\n');

  it('reads MM:SS and HH:MM:SS', () => {
    const out = parseChapterIndex(index);
    expect(out[0]).toMatchObject({ startSeconds: 0, title: 'Introduction' });
    expect(out[1]?.startSeconds).toBe(416);
    expect(out[2]?.startSeconds).toBe(3706);
  });

  it('scopes chapters to the requested volume', () => {
    const vol2 = chaptersForVolume(parseChapterIndex(index), 2);
    expect(vol2).toHaveLength(2);
    expect(vol2[0]?.title).toContain('Bridging Escape');
  });

  it('returns every chapter when the index has no volume headers', () => {
    const flat = parseChapterIndex('00:00 - One\n10:00 - Two');
    expect(chaptersForVolume(flat, 3)).toHaveLength(2);
  });

  it('returns nothing rather than half-parsing an unsupported format', () => {
    expect(
      parseChapterIndex('<table><tr><td>overview</td></tr></table>'),
    ).toEqual([]);
  });
});

describe('chapterAt', () => {
  const chapters = parseChapterIndex('00:00 - A\n10:00 - B\n20:00 - C');

  it('finds the chapter a moment falls in', () => {
    expect(chapterAt(chapters, 0)?.title).toBe('A');
    expect(chapterAt(chapters, 601)?.title).toBe('B');
    expect(chapterAt(chapters, 99999)?.title).toBe('C');
  });

  it('has no chapter when there is no index', () => {
    expect(chapterAt([], 100)).toBeNull();
  });
});

describe('applyCorrections', () => {
  it('fixes the sporadic transcription errors found in the corpus', () => {
    expect(applyCorrections('at high level in juditsu you')).toContain(
      'jiu-jitsu',
    );
    expect(applyCorrections('into the multi-position')).toContain(
      'mounted position',
    );
    expect(applyCorrections('exploiting my opponent’s geese leaf')).toContain(
      'gi sleeve',
    );
  });
});

// ── Validation: the gate between model output and a usable record ───────────
const SOURCE = {
  instructor: 'John Danaher',
  instructional: 'GFF Escapes',
  volume: 2,
};
const noChapters = () => null;

function good(overrides: Record<string, unknown> = {}) {
  return {
    position: 'mount-bottom',
    prescription: 'Bridge to one side to displace him — never straight up.',
    why: 'Vertical bridging does not move his centre of gravity.',
    detail: 'The foot points the direction of the bridge.',
    counter: 'He bases out with the free hand.',
    preconditions: { gi: 'either', level: 'beginner', opponent: 'settled' },
    quote: 'I never just bridge straight up to the ceiling.',
    startSeconds: 384,
    ...overrides,
  };
}

describe('validateRecords', () => {
  it('accepts a well-formed record', () => {
    const { valid, rejected } = validateRecords([good()], SOURCE, noChapters);
    expect(rejected).toHaveLength(0);
    expect(valid[0]).toMatchObject({
      position: 'mount-bottom',
      certified: false,
      contested: false,
    });
    expect(valid[0]?.source.timestamp).toBe('0:06:24');
  });

  it('rejects a position outside the closed vocabulary', () => {
    // A wrong position makes every later lookup confidently wrong.
    const { valid, rejected } = validateRecords(
      [good({ position: 'Side Control' }), good({ position: 'flying-armbar' })],
      SOURCE,
      noChapters,
    );
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toMatch(/canonical/);
  });

  it('rejects a record with no quote — it would be unverifiable', () => {
    const { rejected } = validateRecords(
      [good({ quote: '  ' })],
      SOURCE,
      noChapters,
    );
    expect(rejected[0]?.reason).toMatch(/quote/);
  });

  it('rejects a missing timestamp', () => {
    const { rejected } = validateRecords(
      [good({ startSeconds: 'about six minutes' })],
      SOURCE,
      noChapters,
    );
    expect(rejected[0]?.reason).toMatch(/startSeconds/);
  });

  it('rejects unknown precondition values rather than coercing them', () => {
    const { rejected } = validateRecords(
      [good({ preconditions: { gi: 'kimono', level: 'any' } })],
      SOURCE,
      noChapters,
    );
    expect(rejected[0]?.reason).toMatch(/gi/);
  });

  it('reports every rejection with the offending value', () => {
    // Silent dropping makes a broken run look like a successful one.
    const { rejected } = validateRecords(
      [good({ position: 'nonsense' })],
      SOURCE,
      noChapters,
    );
    expect(rejected[0]?.offending).toBe('nonsense');
    expect(rejected[0]?.index).toBe(0);
  });

  it('defaults preconditions when the model omits them', () => {
    const { valid } = validateRecords(
      [good({ preconditions: undefined })],
      SOURCE,
      noChapters,
    );
    expect(valid[0]?.preconditions).toEqual({
      gi: 'either',
      level: 'any',
      opponent: '',
    });
  });

  it('tags the chapter a record falls in', () => {
    const { valid } = validateRecords(
      [good()],
      SOURCE,
      () => 'Bridging Escape',
    );
    expect(valid[0]?.chapter).toBe('Bridging Escape');
  });
});

describe('assignIds', () => {
  function rec(startSeconds: number): MinedRecord {
    return validateRecords([good({ startSeconds })], SOURCE, noChapters)
      .valid[0]!;
  }

  it('is deterministic for the same input', () => {
    const a = assignIds([rec(384), rec(60)], 'gff-escapes-v2');
    const b = assignIds([rec(60), rec(384)], 'gff-escapes-v2');
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });

  it('encodes the volume and the timestamp', () => {
    expect(assignIds([rec(384)], 'gff-escapes-v2')[0]?.id).toBe(
      'gff-escapes-v2-0624',
    );
  });

  it('disambiguates records sharing a timestamp', () => {
    const ids = assignIds([rec(384), rec(384)], 'gff-escapes-v2').map(
      (r) => r.id,
    );
    expect(ids).toEqual(['gff-escapes-v2-0624', 'gff-escapes-v2-0624-2']);
  });

  it('orders by timestamp regardless of the order the model returned', () => {
    const ids = assignIds([rec(600), rec(60)], 'v').map((r) => r.id);
    expect(ids).toEqual(['v-0100', 'v-1000']);
  });
});

describe('chapterCoverage', () => {
  const chapters = [
    { title: 'A', startSeconds: 0 },
    { title: 'B', startSeconds: 600 },
    { title: 'C', startSeconds: 1200 },
  ];
  const at = (s: number) =>
    validateRecords([good({ startSeconds: s })], SOURCE, noChapters).valid[0]!;

  it('counts records per chapter', () => {
    const cov = chapterCoverage([at(10), at(20), at(700)], chapters);
    expect(cov.map((c) => c.recordCount)).toEqual([2, 1, 0]);
  });

  it('surfaces chapters that produced nothing', () => {
    // The visible symptom of a model summarising instead of exhausting.
    const cov = chapterCoverage([at(10)], chapters);
    expect(cov.filter((c) => c.recordCount === 0).map((c) => c.title)).toEqual([
      'B',
      'C',
    ]);
  });
});

describe('validateRecords — precondition synonyms', () => {
  // Rejecting "any" for gi cost an entire volume: 23 of 24 records discarded
  // over one word that meant exactly what "either" means.
  it('normalises gi synonyms instead of rejecting them', () => {
    for (const [given, expected] of [
      ['any', 'either'],
      ['both', 'either'],
      ['no gi', 'no-gi'],
      ['nogi', 'no-gi'],
      ['GI', 'gi'],
    ] as const) {
      const { valid, rejected } = validateRecords(
        [good({ preconditions: { gi: given, level: 'any' } })],
        SOURCE,
        noChapters,
      );
      expect(rejected).toHaveLength(0);
      expect(valid[0]?.preconditions.gi).toBe(expected);
    }
  });

  it('normalises level synonyms', () => {
    const { valid } = validateRecords(
      [good({ preconditions: { gi: 'either', level: 'high level' } })],
      SOURCE,
      noChapters,
    );
    expect(valid[0]?.preconditions.level).toBe('advanced');
  });

  it('still rejects a genuinely unknown value', () => {
    // Forgiving on phrasing, strict on meaning.
    const { rejected } = validateRecords(
      [good({ preconditions: { gi: 'sometimes', level: 'any' } })],
      SOURCE,
      noChapters,
    );
    expect(rejected[0]?.reason).toMatch(/gi/);
  });

  it('never normalises an out-of-taxonomy position', () => {
    // A wrong position is dangerous in a way a synonym is not.
    const { rejected } = validateRecords(
      [good({ position: 'side control bottom' })],
      SOURCE,
      noChapters,
    );
    expect(rejected).toHaveLength(1);
  });
});

describe('isUnscopedAbsolute (#102)', () => {
  const rec = (prescription: string, opponent = '') => ({
    prescription,
    preconditions: { opponent },
  });

  it('flags an absolute with no stated scope', () => {
    // The real collision: two of these, same position, same instructor,
    // opposite instructions, nothing to tell them apart.
    expect(
      isUnscopedAbsolute(
        rec('Never play with an underhook while maintaining a knee shield.'),
      ),
    ).toBe(true);
  });

  it.each([
    'Always keep your knee and elbow connected.',
    'Do not let the opponent close a chest-to-chest position.',
    'You must have an upper body connection.',
    'Avoid crossing your feet.',
    "Don't hang onto a locked triangle.",
  ])('flags %j', (p) => expect(isUnscopedAbsolute(rec(p))).toBe(true));

  it('does NOT flag an absolute that says when it applies', () => {
    // Scoping is the fix, not softening. The instruction stays absolute.
    expect(
      isUnscopedAbsolute(
        rec(
          'Never play with an underhook while maintaining a knee shield.',
          'Opponent is playing a low knee shield with locked legs.',
        ),
      ),
    ).toBe(false);
  });

  it('does not flag ordinary hedged advice', () => {
    // A record without an absolute degrades gracefully — the model weighs it
    // against its neighbours instead of obeying or contradicting it.
    expect(
      isUnscopedAbsolute(rec('Frame on the far hip before he settles.')),
    ).toBe(false);
  });

  it('matches whole words only', () => {
    // "mustache", "nevertheless" and friends must not trip it.
    expect(isUnscopedAbsolute(rec('Grip the mustard-coloured lapel.'))).toBe(
      false,
    );
    expect(isUnscopedAbsolute(rec('Nevertheless, frame early.'))).toBe(false);
  });

  it('treats a whitespace-only precondition as absent', () => {
    expect(isUnscopedAbsolute(rec('Never cross your feet.', '   '))).toBe(true);
  });
});
