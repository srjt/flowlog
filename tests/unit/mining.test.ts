import {
  assignIds,
  chapterCoverage,
  isUnscopedAbsolute,
  repairQuote,
  validateRecords,
  type MinedRecord,
} from '../../scripts/mining/records';
import { applyCorrections } from '../../scripts/mining/prompt';
import {
  chapterAt,
  chaptersForVolume,
  chunkLines,
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

describe('repairQuote', () => {
  // One passage, used throughout: the repair is defined against real
  // transcript text, so the tests read it the way a reviewer would.
  const transcript =
    'So I take my whole hand over the shoulder and I just give a quick pull. ' +
    'Now watch what happens to his base here. ' +
    'And I move my chin off the shoulder so the crossface has nothing to press on.';

  it('leaves a quote that is already verbatim untouched', () => {
    const r = repairQuote(
      'I take my whole hand over the shoulder and I just give a quick pull',
      transcript,
    );
    expect(r.repaired).toBe(false);
    expect(r.unverifiable).toBe(false);
    expect(r.dropped).toBe(0);
  });

  it('narrows a spliced quote to the longest span the transcript contains', () => {
    // The two halves are real and minutes apart in the source; the sentence
    // joining them was never spoken. This is the 20.5% case.
    const spliced =
      'So I take my whole hand over the shoulder and I just give a quick pull ' +
      'and I move my chin off the shoulder so the crossface has nothing to press on.';
    const r = repairQuote(spliced, transcript);
    expect(r.repaired).toBe(true);
    expect(r.dropped).toBeGreaterThan(0);
    // Whatever it returns must be findable in the transcript verbatim — that
    // is the entire point, so assert it rather than a fixed string.
    expect(transcript).toContain(r.quote);
  });

  it('returns real transcript text, with its own punctuation and casing', () => {
    const r = repairQuote(
      'now watch what happens to his base here and then something never said',
      transcript,
    );
    expect(r.repaired).toBe(true);
    // Lowercased and unpunctuated going in, real transcript text coming out.
    expect(r.quote).toBe('Now watch what happens to his base here');
  });

  it('does not leave the quote ending on a dangling connective', () => {
    // "here. And" matches verbatim, because the spliced half began with "and".
    // Keeping it reads as though the tool truncated the sentence.
    const r = repairQuote(
      'now watch what happens to his base here and then something never said',
      transcript,
    );
    expect(r.quote.trim()).not.toMatch(/\b(and|but|so|then|the|to)$/i);
  });

  it('flags a quote with no substantial span as unverifiable', () => {
    const r = repairQuote(
      'He posts his free hand and re-pummels to recover the underhook',
      transcript,
    );
    expect(r.unverifiable).toBe(true);
    expect(r.repaired).toBe(false);
  });

  it('never invents text — the result is always a transcript substring', () => {
    for (const q of [
      'whole hand over the shoulder and I just give a quick pull',
      'so I take my whole hand and I move my chin off the shoulder',
      'Now watch what happens to his base',
    ]) {
      const r = repairQuote(q, transcript);
      if (!r.unverifiable) expect(transcript).toContain(r.quote);
    }
  });

  it('prefers the span that backs the claim over the longest one', () => {
    // The failure this guards against, measured on the real corpus: taking the
    // longest span lost more than half the support for the record's own claim
    // in 30% of repairs, leaving a verbatim quote that is evidence for nothing.
    const t =
      'I will show you the other angle very soon and it is going to go on ' +
      'this rib cage which we will cover later on. ' +
      'Your tight waist grip switches to the other side as he posts.';
    const spliced =
      'I will show you the other angle very soon and it is going to go on ' +
      'this rib cage and your tight waist grip switches to the other side as he posts.';
    const claim = 'Switch your tight waist grip when the opponent posts.';
    const withClaim = repairQuote(spliced, t, claim);
    expect(t).toContain(withClaim.quote);
    expect(withClaim.quote).toContain('tight waist grip');
    // Without the claim the longest span wins, which here is the aside.
    const without = repairQuote(spliced, t);
    expect(without.quote).not.toContain('tight waist grip');
  });

  it('treats an empty quote as unverifiable rather than throwing', () => {
    expect(repairQuote('', transcript).unverifiable).toBe(true);
  });

  it('matches across apostrophes and hyphens', () => {
    // Regression. The quote side deleted punctuation ("doesn't" -> "doesnt")
    // while the transcript side split on it ("doesn", "t"), so the two never
    // agreed. Every quote containing an apostrophe or hyphen was reported
    // unverifiable — including quotes that were verbatim — and the repair
    // trimmed good text. It made Gemini look like it spliced 14 records in 15.
    const t = "He doesn't want to give you the under-hook, so don't fight it.";
    const r = repairQuote("He doesn't want to give you the under-hook", t);
    expect(r.unverifiable).toBe(false);
    expect(r.repaired).toBe(false);
  });
});

describe('chunkLines', () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({
    startSeconds: i * 30,
    text: `line ${i}`,
  }));

  it('splits on a fixed window when the title ships no chapter index', () => {
    const chunks = chunkLines(lines, [], 480);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('loses no lines — every segment lands in exactly one window', () => {
    // The failure this guards against is silent: a dropped window looks
    // exactly like a volume that simply taught less.
    const chunks = chunkLines(lines, [], 480);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(lines.length);
    expect(chunks.flat().map((l) => l.startSeconds)).toEqual(
      lines.map((l) => l.startSeconds),
    );
  });

  it('never lets a chapter-aligned window run far over the target', () => {
    // Regression, and it cost real records. Breaking at the first boundary at
    // or AFTER the target overshot: ~5-minute chapters produced 9-12 minute
    // windows against an 8-minute target, and the model summarised them —
    // 18 records where fixed windows got 33, across one position instead of
    // three. An over-long window is the failure chunking exists to prevent.
    const long = Array.from({ length: 110 }, (_, i) => ({
      startSeconds: i * 30,
      text: `line ${i}`,
    }));
    const every5min = Array.from({ length: 10 }, (_, i) => ({
      startSeconds: i * 318,
      title: `C${i}`,
      volume: null,
    }));
    const chunks = chunkLines(long, every5min, 480);
    for (const c of chunks) {
      const span = c[c.length - 1]!.startSeconds - c[0]!.startSeconds;
      expect(span).toBeLessThanOrEqual(480 * 1.25);
    }
  });

  it('breaks on chapter boundaries when an index exists', () => {
    const chapters = [
      { startSeconds: 0, title: 'A', volume: null },
      { startSeconds: 600, title: 'B', volume: null },
      { startSeconds: 1200, title: 'C', volume: null },
    ];
    const chunks = chunkLines(lines, chapters, 480);
    // A window must start exactly where a chapter does, not mid-technique.
    expect(chunks[1]![0]!.startSeconds).toBe(600);
  });

  it('returns one window for a transcript shorter than the window', () => {
    expect(chunkLines(lines.slice(0, 3), [], 480)).toHaveLength(1);
  });

  it('returns nothing for no lines', () => {
    expect(chunkLines([], [], 480)).toEqual([]);
  });
});

describe('parseChapterIndex — title-first ranges', () => {
  // The format a chapter list is pasted in from a product page: title first,
  // then a start-end range, under a titled volume header and column headings.
  const index = [
    'Volume 01: Pin Escapes & Turtle Escapes 1',
    'CHAPTER TITLE',
    'START TIME',
    'introduction\t0:00 - 6:56',
    'Escapes Overview\t6:56 - 43:37',
    'Defense & Escapes - General Reflections\t43:37 - 49:50',
    'Bridging\t1:25:21 - 1:33:00',
  ].join('\n');

  it('reads title-first rows with a start-end range', () => {
    const got = parseChapterIndex(index);
    expect(got).toHaveLength(4);
    expect(got[0]).toMatchObject({
      startSeconds: 0,
      endSeconds: 416,
      title: 'introduction',
    });
    expect(got[3]).toMatchObject({
      startSeconds: 5121,
      endSeconds: 5580,
      title: 'Bridging',
    });
  });

  it('reads a titled volume header, not just a bare VOLUME n', () => {
    expect(parseChapterIndex(index)[0]!.volume).toBe(1);
  });

  it('skips column headings instead of making chapters of them', () => {
    const titles = parseChapterIndex(index).map((c) => c.title);
    expect(titles).not.toContain('CHAPTER TITLE');
    expect(titles).not.toContain('START TIME');
  });

  it('keeps a dash inside a chapter title', () => {
    expect(parseChapterIndex(index)[2]!.title).toBe(
      'Defense & Escapes - General Reflections',
    );
  });

  it('still reads the timestamp-first form', () => {
    const got = parseChapterIndex(
      '6:56 - Escapes Overview\n1:25:21 - Bridging',
    );
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({ startSeconds: 5121, title: 'Bridging' });
    expect(got[1]!.endSeconds).toBeUndefined();
  });

  it('ignores a row whose range runs backwards', () => {
    expect(parseChapterIndex('Bad Row\t10:00 - 2:00')).toHaveLength(0);
  });
});

describe('chapterAt with stated ends', () => {
  const chapters = [
    { startSeconds: 0, endSeconds: 100, title: 'A', volume: null },
    { startSeconds: 200, endSeconds: 300, title: 'B', volume: null },
  ];

  it('finds the chapter a moment falls inside', () => {
    expect(chapterAt(chapters, 250)?.title).toBe('B');
  });

  it('returns null for a moment in a gap the index left', () => {
    // 150 is past A's stated end and before B starts. Attributing it to A
    // would put a record under a chapter it does not belong to.
    expect(chapterAt(chapters, 150)).toBeNull();
  });

  it('returns null past the end of the last chapter', () => {
    expect(chapterAt(chapters, 5000)).toBeNull();
  });
});
