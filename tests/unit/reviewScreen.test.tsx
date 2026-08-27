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

const queue = (records: unknown[], extra: Record<string, unknown> = {}) => ({
  records,
  tallies: new Map(),
  myVotes: new Set<string>(),
  priorVotes: new Map(),
  myVoteFor: new Map(),
  ...extra,
});

describe('ReviewScreen (#77)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('tells a signed-out visitor to sign in, not that they lack access', async () => {
    mockWhoAmI.mockResolvedValue({ state: 'signed-out' });
    const { findByTestId } = render(<ReviewScreen />);
    expect(await findByTestId('review-signed-out')).toBeTruthy();
  });

  it('tells a signed-in non-reviewer they are not on the list', async () => {
    // RLS makes a non-reviewer's queue look identical to a completed one, so
    // say which it is rather than congratulating them on invisible work.
    mockWhoAmI.mockResolvedValue({ state: 'not-a-reviewer' });
    const { findByTestId } = render(<ReviewScreen />);
    expect(await findByTestId('review-not-reviewer')).toBeTruthy();
  });

  it('reports a lookup failure as OUR fault, not a permissions answer', async () => {
    // A recursive RLS policy returned HTTP 500 and the bench rendered it as
    // "Not a reviewer". A backend fault wearing the costume of a policy
    // decision is close to undiagnosable from the UI.
    mockWhoAmI.mockResolvedValue({
      state: 'error',
      message: 'infinite recursion detected in policy for relation "reviewers"',
    });
    const { findByTestId, findByText } = render(<ReviewScreen />);
    expect(await findByTestId('review-error')).toBeTruthy();
    expect(await findByText(/fault on our side/i)).toBeTruthy();
  });

  it('leads with the situation, in words, before the advice', async () => {
    // The card that prompted this said only `back-mount-bottom`, and a
    // reviewer had to decode it before they could judge anything.
    mockWhoAmI.mockResolvedValue({
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: 'black belt' },
    });
    mockLoadQueue.mockResolvedValue(
      queue([record('a', { position: 'back-mount-bottom' })]),
    );

    const { findByTestId, findByText } = render(<ReviewScreen />);
    await findByTestId('review-situation');

    expect(await findByText('Back control')).toBeTruthy();
    expect(await findByText('You are underneath')).toBeTruthy();
    expect(await findByText(/they have your back/i)).toBeTruthy();
  });

  it('never shows a raw enum value like "either" to a reviewer', async () => {
    mockWhoAmI.mockResolvedValue({
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
    });
    mockLoadQueue.mockResolvedValue(queue([record('a')]));

    const { findByText, queryByText } = render(<ReviewScreen />);
    expect(await findByText('Gi and no-gi')).toBeTruthy();
    expect(queryByText(/Applies when: either/)).toBeNull();
  });

  it('shows the first card with its distilled text', async () => {
    mockWhoAmI.mockResolvedValue({
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: 'black belt' },
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
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
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
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
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
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
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
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
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
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: null },
    });
    mockLoadQueue.mockResolvedValue(queue([]));

    const { findByText } = render(<ReviewScreen />);
    expect(await findByText('Queue clear')).toBeTruthy();
  });
});

describe('ReviewScreen — reviewer notes (#84)', () => {
  beforeEach(() => jest.clearAllMocks());

  const asReviewer = () =>
    mockWhoAmI.mockResolvedValue({
      state: 'reviewer',
      identity: { id: 'r1', displayName: 'Ana', credential: 'black belt' },
    });

  const priorReject = () =>
    new Map([
      [
        'a',
        [
          {
            reviewerId: 'r2',
            reviewerName: 'Bruno',
            credential: 'black belt',
            verdict: 'reject' as const,
            note: 'the De La Riva hook goes outside the lead leg',
          },
        ],
      ],
    ]);

  it('shows that others disagreed without showing the argument yet', async () => {
    // Anchoring: the FACT of disagreement is free, the reasoning costs a tap.
    asReviewer();
    mockLoadQueue.mockResolvedValue(
      queue([record('a')], { priorVotes: priorReject() }),
    );

    const { findByTestId, queryByText } = render(<ReviewScreen />);
    await findByTestId('review-prior');

    expect(queryByText(/goes outside the lead leg/)).toBeNull();
  });

  it('reveals the reasoning, attributed, on request', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(
      queue([record('a')], { priorVotes: priorReject() }),
    );

    const { findByTestId, findByText } = render(<ReviewScreen />);
    fireEvent.press(await findByTestId('review-reveal'));

    expect(await findByText(/goes outside the lead leg/)).toBeTruthy();
    // Unattributed dissent is weaker evidence — the credential travels with it.
    expect(await findByText(/Bruno, black belt/)).toBeTruthy();
  });

  it('refuses a reject with no reason, and says why', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a')]));

    const { findByTestId, getByTestId } = render(<ReviewScreen />);
    await findByTestId('review-card');

    await act(async () => {
      fireEvent.press(getByTestId('review-reject'));
    });

    expect(mockVote).not.toHaveBeenCalled();
    expect(getByTestId('review-reject-hint')).toBeTruthy();
  });

  it('allows a reject once a reason is given', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a')]));
    mockVote.mockResolvedValue(undefined);

    const { findByTestId, getByTestId } = render(<ReviewScreen />);
    await findByTestId('review-card');

    fireEvent.changeText(getByTestId('review-note'), 'wrong entanglement');
    await act(async () => {
      fireEvent.press(getByTestId('review-reject'));
    });

    expect(mockVote).toHaveBeenCalledWith(
      'a',
      'r1',
      'reject',
      'wrong entanglement',
    );
  });

  it('still allows certify without a note — agreement needs no defence', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a')]));
    mockVote.mockResolvedValue(undefined);

    const { findByTestId, getByTestId } = render(<ReviewScreen />);
    await findByTestId('review-card');

    await act(async () => {
      fireEvent.press(getByTestId('review-certify'));
    });

    expect(mockVote).toHaveBeenCalledWith('a', 'r1', 'certify', '');
  });

  it('skips without writing anything to the database', async () => {
    // A reviewer who does not know a position needs an exit that is not a
    // guess. A guessed "sound" is worse than no vote: two of them certify a
    // record nobody actually vouched for.
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a'), record('b')]));

    const { findByTestId, getByTestId, findByText } = render(<ReviewScreen />);
    await findByTestId('review-card');

    fireEvent.press(getByTestId('review-skip'));

    expect(mockVote).not.toHaveBeenCalled();
    expect(await findByText('prescription b')).toBeTruthy();
  });

  it('clears a half-typed note when skipping, so it cannot leak onto the next card', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a'), record('b')]));

    const { findByTestId, getByTestId } = render(<ReviewScreen />);
    await findByTestId('review-card');

    fireEvent.changeText(getByTestId('review-note'), 'half a thought');
    fireEvent.press(getByTestId('review-skip'));

    expect(getByTestId('review-note').props.value).toBe('');
  });

  it('says skipped cards will return, rather than implying they are done', async () => {
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a')]));

    const { findByTestId, getByTestId, findByText } = render(<ReviewScreen />);
    await findByTestId('review-card');
    fireEvent.press(getByTestId('review-skip'));

    expect(await findByText(/skipped card/i)).toBeTruthy();
    expect(await findByText(/not recorded as a verdict/i)).toBeTruthy();
  });

  it('lets a reviewer change the verdict they just sent', async () => {
    // A voted card leaves the queue immediately, so the only moment anyone can
    // fix a mistyped reason is straight after sending it.
    asReviewer();
    mockLoadQueue.mockResolvedValue(queue([record('a'), record('b')]));
    mockVote.mockResolvedValue(undefined);

    const { findByTestId, getByTestId } = render(<ReviewScreen />);
    await findByTestId('review-card');

    fireEvent.changeText(getByTestId('review-note'), 'my earlier reason');
    await act(async () => {
      fireEvent.press(getByTestId('review-reject'));
    });

    expect(getByTestId('review-just-voted')).toBeTruthy();
    fireEvent.press(getByTestId('review-edit-mine'));

    expect(getByTestId('review-editing-banner')).toBeTruthy();
    // The earlier reasoning comes back so it can be amended, not retyped.
    expect(getByTestId('review-note').props.value).toBe('my earlier reason');
  });
});
