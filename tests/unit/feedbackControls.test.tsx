import { fireEvent, render } from '@testing-library/react-native';

import { FeedbackControls } from '@/components/FeedbackControls';

function setup(thumb: boolean | null, note: string | null = null) {
  const onThumb = jest.fn();
  const onReason = jest.fn();
  const onNote = jest.fn();
  const utils = render(
    <FeedbackControls
      thumb={thumb}
      reason={null}
      note={note}
      onThumb={onThumb}
      onReason={onReason}
      onNote={onNote}
    />,
  );
  return { ...utils, onThumb, onReason, onNote };
}

describe('FeedbackControls note', () => {
  it('shows the note field only on 👎', () => {
    const down = setup(false);
    expect(down.getByTestId('feedback-note-input')).toBeTruthy();

    const up = setup(true);
    expect(up.queryByTestId('feedback-note-input')).toBeNull();

    const none = setup(null);
    expect(none.queryByTestId('feedback-note-input')).toBeNull();
  });

  it('commits the typed note to the parent on blur', () => {
    const { getByTestId, onNote } = setup(false);
    const input = getByTestId('feedback-note-input');

    fireEvent.changeText(input, '  cue was too vague, name the grip  ');
    expect(onNote).not.toHaveBeenCalled(); // not on every keystroke
    fireEvent(input, 'blur');

    expect(onNote).toHaveBeenCalledWith('cue was too vague, name the grip');
  });

  it('seeds the field from a previously saved note', () => {
    const { getByTestId } = setup(false, 'earlier note');
    expect(getByTestId('feedback-note-input').props.value).toBe('earlier note');
  });
});
