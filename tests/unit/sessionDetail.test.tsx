import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/config/featureFlags', () => ({
  isDemoMode: false,
  isLocalPipeline: true,
}));
jest.mock('@/services/sessionsSource', () => ({
  loadSessions: jest.fn(async () => []),
  saveSessionFeedback: jest.fn(async () => undefined),
  deleteSession: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { back: jest.fn(), push: jest.fn() },
    // Render the header slots so headerLeft/headerRight controls are reachable
    // at the test seam (the real native header is not mounted under jest).
    Stack: {
      Screen: ({ options }: { options?: Record<string, unknown> }) =>
        React.createElement(
          React.Fragment,
          null,
          typeof options?.headerLeft === 'function'
            ? (options.headerLeft as () => unknown)()
            : null,
          typeof options?.headerRight === 'function'
            ? (options.headerRight as () => unknown)()
            : null,
        ),
    },
    useLocalSearchParams: () => ({ id: 's1' }),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// eslint-disable-next-line import/first
import { router } from 'expo-router';
// eslint-disable-next-line import/first
import { deleteSession } from '@/services/sessionsSource';
// eslint-disable-next-line import/first
import { useSessionStore } from '@/store/sessionStore';
// eslint-disable-next-line import/first
import type { Session } from '@/types/session';
// eslint-disable-next-line import/first
import SessionDetailScreen from '../../app/session/[id]';

function sample(id: string): Session {
  return {
    id,
    userId: 'u',
    sportKey: 'bjj',
    sessionDate: '2026-06-10T10:00:00.000Z',
    audioStoragePath: null,
    rawTranscript: 'I kept getting swept from half guard.',
    positionsVisited: ['Half guard'],
    keyMistake: 'flat hips',
    opponentAction: 'underhook',
    sentiment: 'frustrated',
    coachingCue: 'Get to your side.',
    targetPosition: 'Half guard',
    targetPositionId: null,
    qualityGatePassed: true,
    thumbsUp: null,
    pipelineVersion: 'test',
    createdAt: '2026-06-10T10:00:00.000Z',
  };
}

describe('SessionDetailScreen delete', () => {
  beforeEach(() => {
    useSessionStore.getState().setHistory([sample('s1')]);
    jest.clearAllMocks();
  });

  it('confirms, deletes, removes from history, and navigates back', async () => {
    const { getByTestId } = render(<SessionDetailScreen />);

    // First tap reveals the confirm step (no delete yet).
    fireEvent.press(getByTestId('session-delete'));
    expect(deleteSession).not.toHaveBeenCalled();
    expect(getByTestId('session-delete-confirm')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('session-delete-confirm'));
    });

    expect(deleteSession).toHaveBeenCalledWith('s1');
    expect(useSessionStore.getState().history).toHaveLength(0);
    expect(router.back).toHaveBeenCalled();
  });

  it('shows a "Back" control that navigates back', () => {
    const { getByTestId } = render(<SessionDetailScreen />);
    const back = getByTestId('session-back');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(back.props.accessibilityRole).toBe('button');
    fireEvent.press(back);
    expect(router.back).toHaveBeenCalled();
  });

  it('cancel backs out of the confirm step without deleting', () => {
    const { getByTestId, queryByTestId } = render(<SessionDetailScreen />);
    fireEvent.press(getByTestId('session-delete'));
    fireEvent.press(getByTestId('session-delete-cancel'));
    expect(deleteSession).not.toHaveBeenCalled();
    expect(queryByTestId('session-delete-confirm')).toBeNull();
    expect(getByTestId('session-delete')).toBeTruthy();
  });
});
