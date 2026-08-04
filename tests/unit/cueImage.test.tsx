import { render } from '@testing-library/react-native';

import { CueImage } from '@/components/CueImage';

describe('CueImage', () => {
  it('renders nothing when there is no URL (text-only fallback)', () => {
    const { queryByRole } = render(<CueImage url={null} cue="Frame early." />);
    expect(queryByRole('image')).toBeNull();
  });

  it('renders the image with the cue as its accessibility label', () => {
    const { getByRole } = render(
      <CueImage
        url="https://example.test/cue-images/abc.png"
        cue="Frame early and shrimp."
      />,
    );
    const image = getByRole('image');
    expect(image.props.accessibilityLabel).toContain('Frame early and shrimp.');
    expect(image.props.source).toEqual({
      uri: 'https://example.test/cue-images/abc.png',
    });
  });
});
