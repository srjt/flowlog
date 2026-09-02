import {
  volumeNumber,
  volumeNumbersForDirectory,
} from '../../scripts/mining/volumes';

describe('volumeNumber (#75)', () => {
  describe('conventions that already worked', () => {
    it.each([
      ['GFF - Guard Retention 4', 4],
      ['DynamicPins04', 4],
      ['PillarsofDefense-PinEscapesbyGordonRyan3', 3],
      ['Systematically Attacking the Guard 2 by Gordon Ryan - 1', 1],
      ['Ageless Jiu Jitsu Bottom Game 3', 3],
    ])('%s -> %i', (stem, n) => expect(volumeNumber(stem)).toBe(n));
  });

  describe('conventions that were silently dropped', () => {
    it.each([
      ['1 Ageless Jiu Jitsu - Top Game', 1],
      ['8 Ageless Jiu Jitsu - Top Game', 8],
      ['They.Shall.Not.Pass.vol1.720p.WEB-DL.x264-ZED', 1],
      ['Back Attacks Vol 1 - Straitjacket System', 1],
    ])('%s -> %i', (stem, n) => expect(volumeNumber(stem)).toBe(n));
  });

  it('reads the vol marker, not the chapter number that trails it', () => {
    // The trap: the trailing 2 belongs to the title. Taking it both loses
    // volume 4 and collides with the real volume 2.
    expect(
      volumeNumber('Back Attacks Vol 4 Workings of Straitjacket System 2'),
    ).toBe(4);
  });

  it('is not fooled by resolution or codec digits', () => {
    // "any number anywhere" would match 720 or 264.
    expect(volumeNumber('They.Shall.Not.Pass.vol3.720p.WEB-DL.x264-ZED')).toBe(
      3,
    );
  });

  it('prefers an explicit marker over a leading number', () => {
    expect(volumeNumber('2020 Series Vol 7')).toBe(7);
  });

  it('returns null for a file with no number at all', () => {
    expect(volumeNumber('Contents')).toBeNull();
    expect(volumeNumber('Chapter Index')).toBeNull();
  });

  it('handles Volume spelled out', () => {
    expect(volumeNumber('Feet To Floor Volume 2 - John Danaher')).toBe(2);
  });
});

describe('volumeNumbersForDirectory', () => {
  it('numbers a series whose marker names the SERIES, not the file', () => {
    // All eight carry "Vol.3"; the trailing number is the real volume. Read one
    // at a time they all come back 3, collapse onto one slug, and seven of the
    // eight vanish from every mining run.
    const stems = Array.from(
      { length: 8 },
      (_, i) => `John Danaher Feet to Floor Vol.3 - ${i + 1}`,
    );
    expect([...volumeNumbersForDirectory(stems).values()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('still prefers a varying marker over a trailing number', () => {
    // The documented counterexample: the trailing 2 belongs to the chapter
    // title, not the volume.
    const stems = [
      'Back Attacks Vol 1 - Straitjacket System',
      'Back Attacks Vol 2 10 Critical Principles',
      'Back Attacks Vol 3 Workings of Straitjacket System',
      'Back Attacks Vol 4 Workings of Straitjacket System 2',
    ];
    expect([...volumeNumbersForDirectory(stems).values()]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('leaves a conventional series alone', () => {
    const stems = Array.from(
      { length: 8 },
      (_, i) => `GFF - Gi Fundamentals - Escapes Vol ${i + 1}`,
    );
    expect([...volumeNumbersForDirectory(stems).values()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('does not treat a lone file as a series label', () => {
    // One file cannot tell us the marker is shared, so the single-file rule
    // stands rather than guessing.
    expect([
      ...volumeNumbersForDirectory(['Some Title Vol 3']).values(),
    ]).toEqual([3]);
  });

  it('assigns every file a distinct volume, or the slug collides', () => {
    const stems = Array.from(
      { length: 7 },
      (_, i) => `John Danaher Feet to Floor Vol.2 - ${i + 1}`,
    );
    const nums = [...volumeNumbersForDirectory(stems).values()];
    expect(new Set(nums).size).toBe(stems.length);
  });
});
