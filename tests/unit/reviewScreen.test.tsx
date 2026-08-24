import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockWhoAmI = jest.fn();
const mockLoadQueue = jest.fn();
const mockVote = jest.fn();

jest.mock('@/services/ReviewService', () => ({
  reviewService: {
    whoAmI: (...a: unknown[]) => mockWhoAmI(...a),
    loadQueue: (...a: unknown[]) => mockLoadQueue(...a),
    vote: (...a: unknown[]) => mockVote(...a),
  },
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import ReviewScreen from '../../app/review/index';

const record = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  position: 'closed-guard-bottom',
  prescription: `prescription ${id}`,
  why: 'because the elbow crosses the centre line',
  detail: '',
  counter: '',
  gi: 'either',
  level: 'any',
  opponent: null,
  certified: false,
  contested: false,
  rejected: false,
  ...over,
});

const queue = (records: unknown[]) => ({
  records,
  tallies: new Map(),
  myVotes: new Set<string>(),
});

describe('ReviewScreen (#77)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tells a non-reviewer they lack access, not that the queue is finished', async () => {
    // RLS makes a non-reviewer's queue look identical to a completed one.
    mockWhoAmI.mockResolvedValue(null);
    const { findByText } = render(<ReviewScreen />);
    expect(await findByText('Not a reviewer')).toBeTruthy();
  });

  it('shows the first card with its distilled text', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: 'black belt',
    });
    mockLoadQueue.mockResolvedValue(queue([record('a')]));

    const { findByText, getByTestId } = render(<ReviewScreen />);

    expect(await findByText('prescription a')).toBeTruthy();
    expect(getByTestId('review-progress').props.children.join('')).toMatch(
      /Ana/,
    );
  });

  it('never renders a source quote — the field is not even fetched', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: null,
    });
    mockLoadQueue.mockResolvedValue(queue([record('a')]));

    const { findByText, queryByText } = render(<ReviewScreen />);
    await findByText('prescription a');

    // The serving store carries no quote; this asserts the UI never invents a
    // place to show one, which is what keeps the bench shareable.
    expect(queryByText(/quote/i)).toBeNull();
  });

  it('records a verdict and advances to the next card', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: null,
    });
    mockLoadQueue.mockResolvedValue(queue([record('a'), record('b')]));
    mockVote.mockResolvedValue(undefined);

    const { findByText, getByTestId } = render(<ReviewScreen />);
    await findByText('prescription a');

    await act(async () => {
      fireEvent.press(getByTestId('review-certify'));
    });

    expect(mockVote).toHaveBeenCalledWith('a', 'r1', 'certify', '');
    await waitFor(() => expect(getByTestId('review-card')).toBeTruthy());
    expect(await findByText('prescription b')).toBeTruthy();
  });

  it('passes the note along with a reject', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: null,
    });
    mockLoadQueue.mockResolvedValue(queue([record('a')]));
    mockVote.mockResolvedValue(undefined);

    const { findByText, getByTestId } = render(<ReviewScreen />);
    await findByText('prescription a');

    fireEvent.changeText(
      getByTestId('review-note'),
      'the hook goes outside, not inside',
    );
    await act(async () => {
      fireEvent.press(getByTestId('review-reject'));
    });

    expect(mockVote).toHaveBeenCalledWith(
      'a',
      'r1',
      'reject',
      'the hook goes outside, not inside',
    );
  });

  it('keeps the card and explains when a vote fails to save', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: null,
    });
    mockLoadQueue.mockResolvedValue(queue([record('a')]));
    mockVote.mockRejectedValue(new Error('offline'));

    const { findByText, getByTestId } = render(<ReviewScreen />);
    await findByText('prescription a');

    await act(async () => {
      fireEvent.press(getByTestId('review-certify'));
    });

    expect(await findByText(/did not save/i)).toBeTruthy();
    expect(getByTestId('review-card')).toBeTruthy();
  });

  it('says the queue is clear when there is genuinely nothing left', async () => {
    mockWhoAmI.mockResolvedValue({
      id: 'r1',
      displayName: 'Ana',
      credential: null,
    });
    mockLoadQueue.mockResolvedValue(queue([]));

    const { findByText } = render(<ReviewScreen />);
    expect(await findByText('Queue clear')).toBeTruthy();
  });
});
