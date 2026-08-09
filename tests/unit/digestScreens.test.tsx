import { fireEvent, render } from '@testing-library/react-native';

import type { WeeklyDigest } from '@/services/DigestService';

// Controlled hook + route params so each test drives the screen's inputs.
let mockHistory: WeeklyDigest[] = [];
let mockLoading = false;
let mockParams: { weekId?: string } = {};

jest.mock('@/hooks/useDigestHistory', () => ({
  useDigestHistory: () => ({ history: mockHistory, loading: mockLoading }),
}));
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import { router } from 'expo-router';
// eslint-disable-next-line import/first
import LatestDigestScreen from '../../app/digest/index';
// eslint-disable-next-line import/first
import DigestDetailScreen from '../../app/digest/[weekId]';
// eslint-disable-next-line import/first
import DigestHistoryScreen from '../../app/digest/history';

function digest(overrides: Partial<WeeklyDigest> = {}): WeeklyDigest {
  return {
    id: 'bjj-2026-06-08',
    weekStart: '2026-06-08',
    sport: 'bjj',
    focusArea: 'Guard',
    recurringLeak: 'flat hips',
    body: 'Most-worked: Guard. Recurring leak: flat hips.',
    ...overrides,
  };
}

beforeEach(() => {
  mockHistory = [];
  mockLoading = false;
  mockParams = {};
  jest.clearAllMocks();
});

describe('LatestDigestScreen', () => {
  it('renders the most recent digest recap', () => {
    mockHistory = [digest({ weekStart: '2026-06-08' })];
    const { getByText, getByTestId } = render(<LatestDigestScreen />);
    expect(getByTestId('weekly-digest')).toBeTruthy();
    expect(getByText('Guard')).toBeTruthy();
    expect(getByText('flat hips')).toBeTruthy();
    expect(
      getByText('Most-worked: Guard. Recurring leak: flat hips.'),
    ).toBeTruthy();
  });

  it('shows an empty state when there are no digests yet', () => {
    mockHistory = [];
    const { getByText, queryByTestId } = render(<LatestDigestScreen />);
    expect(getByText('No digests yet')).toBeTruthy();
    expect(queryByTestId('weekly-digest')).toBeNull();
  });

  it('offers a history link only when more than one digest exists', () => {
    mockHistory = [digest()];
    const single = render(<LatestDigestScreen />);
    expect(single.queryByTestId('digest-view-history')).toBeNull();

    mockHistory = [
      digest({ id: 'bjj-2026-06-08' }),
      digest({ id: 'bjj-2026-06-01', weekStart: '2026-06-01' }),
    ];
    const many = render(<LatestDigestScreen />);
    fireEvent.press(many.getByTestId('digest-view-history'));
    expect(router.push).toHaveBeenCalledWith('/digest/history');
  });
});

describe('DigestDetailScreen', () => {
  it('renders the digest matching the route weekId', () => {
    mockHistory = [digest({ id: 'bjj-2026-06-08' })];
    mockParams = { weekId: 'bjj-2026-06-08' };
    const { getByTestId, getByText } = render(<DigestDetailScreen />);
    expect(getByTestId('weekly-digest')).toBeTruthy();
    expect(getByText('flat hips')).toBeTruthy();
  });

  it('shows a not-found message for an unknown weekId', () => {
    mockHistory = [digest({ id: 'bjj-2026-06-08' })];
    mockParams = { weekId: 'bjj-1999-01-01' };
    const { getByText, queryByTestId } = render(<DigestDetailScreen />);
    expect(getByText('Digest not found.')).toBeTruthy();
    expect(queryByTestId('weekly-digest')).toBeNull();
  });
});

describe('DigestHistoryScreen', () => {
  it('lists digests and opens one on press', () => {
    mockHistory = [
      digest({ id: 'bjj-2026-06-08', weekStart: '2026-06-08' }),
      digest({ id: 'bjj-2026-06-01', weekStart: '2026-06-01' }),
    ];
    const { getByTestId } = render(<DigestHistoryScreen />);
    expect(getByTestId('digest-row-bjj-2026-06-08')).toBeTruthy();
    fireEvent.press(getByTestId('digest-row-bjj-2026-06-01'));
    expect(router.push).toHaveBeenCalledWith('/digest/bjj-2026-06-01');
  });

  it('shows an empty state when there is no history', () => {
    mockHistory = [];
    const { getByTestId } = render(<DigestHistoryScreen />);
    expect(getByTestId('digest-history-empty')).toBeTruthy();
  });
});
