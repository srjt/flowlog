import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useSessionStore } from '@/store/sessionStore';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

const mockTranscribe = jest.fn();
let mockState: unknown = { status: 'loading' };
jest.mock('@/hooks/useTranscribe', () => ({
  useTranscribe: () => ({ state: mockState, transcribe: mockTranscribe }),
}));

// eslint-disable-next-line import/first
import TranscriptScreen from '../../app/(flow)/transcript';

describe('TranscriptScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({
      audioUri: 'file:///take.m4a',
      editedTranscript: null,
    });
    mockState = { status: 'loading' };
  });

  it('transcribes the take on mount and shows a loading state', () => {
    const { getByText } = render(<TranscriptScreen />);
    expect(mockTranscribe).toHaveBeenCalledWith('file:///take.m4a');
    expect(getByText('Transcribing…')).toBeTruthy();
  });

  it('lets the user edit the transcript, then stores it and analyzes', async () => {
    mockState = { status: 'ready', transcript: 'i rolled three rounds' };
    const { getByTestId } = render(<TranscriptScreen />);

    // Seeded from the transcript, then corrected by the user.
    const input = getByTestId('transcript-input');
    expect(input.props.value).toBe('i rolled three rounds');
    fireEvent.changeText(input, 'I rolled three rounds and hit a kimura');

    await act(async () => {
      fireEvent.press(getByTestId('transcript-analyze'));
    });

    expect(useSessionStore.getState().editedTranscript).toBe(
      'I rolled three rounds and hit a kimura',
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/(flow)/processing'),
    );
  });

  it('shows Try again / Re-record on a transcription error', () => {
    mockState = {
      status: 'error',
      message:
        'That recording was too short to analyze. Try a longer reflection.',
    };
    const { getByTestId, getByText } = render(<TranscriptScreen />);
    expect(getByText(/too short/i)).toBeTruthy();
    expect(getByTestId('transcript-retry')).toBeTruthy();
    expect(getByTestId('transcript-rerecord')).toBeTruthy();
  });

  it('Re-record clears state and returns to Record', () => {
    mockState = { status: 'ready', transcript: 'anything' };
    useSessionStore.setState({ clientSessionId: 'key-1' });
    const { getByTestId } = render(<TranscriptScreen />);
    fireEvent.press(getByTestId('transcript-rerecord'));

    expect(useSessionStore.getState().clientSessionId).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/record');
  });
});
