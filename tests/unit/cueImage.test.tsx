import { render } from '@testing-library/react-native';

import { CueImage } from '@/components/CueImage';

describe('CueImage', () => {
  it('renders nothing when there is no URL (text-only fallback)', () => {
    const { queryByRole } = render(<CueImage url={null} cue="Frame early." />);
    expect(queryByRole('image')).toBeNull();
  });

  it('renders nothing even with a URL while the kill-switch is off (pivot, map #10)', () => {
    // CUE_IMAGES_ENABLED is false: the generative image path is retired until
    // the annotation force-diagram renderer ships, so we show cue text only.
    const { queryByRole } = render(
      <CueImage
        url="https://example.test/cue-images/abc.png"
        cue="Frame early and shrimp."
      />,
    );
    expect(queryByRole('image')).toBeNull();
  });
});
