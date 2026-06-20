import { render } from '@testing-library/react-native';

import { useSessionStore } from '@/store/sessionStore';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

jest.mock('@/hooks/usePipeline', () => ({
  usePipeline: () => ({ process: jest.fn().mockResolvedValue(null) }),
}));

jest.mock('react-native-safe-area-context', () => {
  const RN = require('react-native');
  return { SafeAreaView: RN.View };
});

// Imported after the mocks so the screen picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import ProcessingScreen from '../../app/(flow)/processing';

describe('ProcessingScreen — error state', () => {
  it('shows a friendly message plus Try again and Discard, with no raw error', () => {
    useSessionStore.setState({
      status: 'error',
      errorMessage:
        'Couldn’t reach the server. Check your connection and try again.',
      audioUri: 'blob://recording',
      steps: [],
      latestResult: null,
    });

    const { getByText, queryByText } = render(<ProcessingScreen />);

    // Both recovery actions are available.
    expect(getByText('Try again')).toBeTruthy();
    expect(getByText('Discard')).toBeTruthy();

    // Friendly copy is shown...
    expect(getByText(/check your connection/i)).toBeTruthy();

    // ...and no raw/technical detail leaks into the UI.
    expect(queryByText(/network error|stack|\.ts:|\b500\b/i)).toBeNull();
  });
});
