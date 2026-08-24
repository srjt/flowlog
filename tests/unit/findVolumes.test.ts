import { volumeNumber } from '../../scripts/mining/volumes';

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
