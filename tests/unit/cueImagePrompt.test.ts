import { buildCueImagePrompt } from '@/utils/cueImagePrompt';

const STYLE = 'Two stylized grapplers in a gi on a mat.';

describe('buildCueImagePrompt', () => {
  it('includes the sport style hint, the cue, and the target position', () => {
    const prompt = buildCueImagePrompt({
      cue: 'Frame early and shrimp.',
      targetPosition: 'closed guard',
      styleHint: STYLE,
    });
    expect(prompt).toContain(STYLE);
    expect(prompt).toContain('Frame early and shrimp.');
    expect(prompt).toContain('closed guard');
  });

  it('always forbids text in the image (cue renders as real text elsewhere)', () => {
    const prompt = buildCueImagePrompt({
      cue: 'Post on the far hand.',
      targetPosition: null,
      styleHint: STYLE,
    });
    expect(prompt.toLowerCase()).toContain('no text');
  });

  it('omits the position clause when there is no target position', () => {
    const prompt = buildCueImagePrompt({
      cue: 'Post on the far hand.',
      targetPosition: null,
      styleHint: STYLE,
    });
    expect(prompt).not.toContain('position.');
  });
});
