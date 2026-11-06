import { render, waitFor } from '@testing-library/react-native';

import type { Session } from '@/types/session';

/**
 * The Trends tab surfaces a recurring Weakness (#1): the position the athlete's
 * key mistake keeps landing on. It is not the Focus area, and not the newest
 * mistake relabelled as "recurring".
 */
let mockSessions: Session[] = [];

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    // Run the focus callback once on mount, as a focused tab would.
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('@/services/sessionsSource', () => ({
  loadSessions: jest.fn(() => Promise.resolve(mockSessions)),
}));
jest.mock('@/services/DigestService', () => ({
  applyDigestPrefsWithHistory: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import TrendsScreen from '../../app/(tabs)/trends';

function session(day: number, overrides: Partial<Session> = {}): Session {
  const date = `2026-06-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  return {
    id: `s${day}`,
    userId: 'u1',
    sportKey: 'bjj',
    sessionDate: date,
    audioStoragePath: null,
    rawTranscript: null,
    positionsVisited: ['Closed Guard'],
    keyMistake: null,
    opponentAction: null,
    sentiment: null,
    coachingCue: null,
    targetPosition: null,
    targetPositionId: null,
    gi: null,
    giSource: null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: 'test',
    createdAt: date,
    ...overrides,
  } as Session;
}

const atMount = (day: number, keyMistake: string) =>
  session(day, {
    targetPositionId: 'mount-bottom',
    targetPosition: 'Mount (bottom)',
    keyMistake,
  });

describe('Trends screen — recurring Weakness', () => {
  it('shows the position the key mistake keeps landing on, with its evidence', async () => {
    mockSessions = [
      atMount(1, 'stayed flat'),
      session(2, {
        targetPositionId: 'half-guard-bottom',
        targetPosition: 'Half guard (bottom)',
        keyMistake: 'lost the underhook',
      }),
      atMount(3, 'bridged too late'),
    ];
    const { findByTestId, getByText } = render(<TrendsScreen />);

    const card = await findByTestId('trends-weakness');
    expect(card).toHaveTextContent(/RECURRING WEAKNESS/);
    expect(card).toHaveTextContent(/Mount \(bottom\)/);
    expect(card).toHaveTextContent(/2 of your last 3 rolls/);
    expect(card).toHaveTextContent(/Latest: bridged too late/);
    // The Focus area is still most-logged ("Closed Guard" in every session),
    // shown separately, and never presented as the weakness.
    expect(getByText('FOCUS AREA')).toBeTruthy();
    expect(card).not.toHaveTextContent(/Closed Guard/);
  });

  it('shows no weakness when nothing has recurred, and does not call recent mistakes recurring', async () => {
    mockSessions = [atMount(1, 'stayed flat'), session(2, { keyMistake: 'x' })];
    const { queryByTestId, findByText, queryByText } = render(<TrendsScreen />);

    expect(await findByText('Recent mistakes')).toBeTruthy();
    await waitFor(() => expect(queryByTestId('trends-weakness')).toBeNull());
    expect(queryByText('Recurring mistakes')).toBeNull();
  });
});
