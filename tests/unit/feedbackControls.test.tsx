import { fireEvent, render } from '@testing-library/react-native';

import { FeedbackControls } from '@/components/FeedbackControls';

function setup(
  thumb: boolean | null,
  note: string | null = null,
  onNote: (n: string) => void | Promise<void> = jest.fn(),
) {
  const onThumb = jest.fn();
  const onReason = jest.fn();
  const noteSpy = jest.fn(onNote);
  const utils = render(
    <FeedbackControls
      thumb={thumb}
      reason={null}
      note={note}
      onThumb={onThumb}
      onReason={onReason}
      onNote={noteSpy}
    />,
  );
  return { ...utils, onThumb, onReason, onNote: noteSpy };
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

  it('commits the typed note to the parent on blur (when changed)', () => {
    const { getByTestId, onNote } = setup(false);
    const input = getByTestId('feedback-note-input');

    fireEvent.changeText(input, '  cue was too vague, name the grip  ');
    expect(onNote).not.toHaveBeenCalled(); // not on every keystroke
    fireEvent(input, 'blur');

    expect(onNote).toHaveBeenCalledWith('cue was too vague, name the grip');
  });

  it('confirms "Saved" only after the parent resolves', async () => {
    const { getByTestId, onNote, findByText } = setup(false);

    fireEvent.changeText(
      getByTestId('feedback-note-input'),
      'grip was unnamed',
    );
    fireEvent.press(getByTestId('feedback-note-save'));

    expect(onNote).toHaveBeenCalledWith('grip was unnamed');
    expect(await findByText(/Saved/)).toBeTruthy();
  });

  it('surfaces an error (and keeps the draft) when the save fails', async () => {
    const failing = jest.fn(() => Promise.reject(new Error('0 rows')));
    const { getByTestId, findByText } = setup(false, null, failing);

    fireEvent.changeText(getByTestId('feedback-note-input'), 'important note');
    fireEvent.press(getByTestId('feedback-note-save'));

    expect(await findByText(/Couldn.t save/)).toBeTruthy();
    // Draft is preserved so the user can retry.
    expect(getByTestId('feedback-note-input').props.value).toBe(
      'important note',
    );
    // And the button is re-enabled for a retry.
    expect(
      getByTestId('feedback-note-save').props.accessibilityState?.disabled,
    ).toBe(false);
  });

  it('keeps Save disabled until there is a new note to save', () => {
    const { getByTestId } = setup(false);
    const save = getByTestId('feedback-note-save');

    expect(save.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(getByTestId('feedback-note-input'), 'x');
    expect(save.props.accessibilityState?.disabled).toBe(false);
  });

  it('seeds the field from a previously saved note', () => {
    const { getByTestId } = setup(false, 'earlier note');
    expect(getByTestId('feedback-note-input').props.value).toBe('earlier note');
  });
});
