// Jest setup — runs before each test file.
// Provide deterministic, safe defaults for env-driven code under test.

process.env.APP_NAME = 'Flowlog';
process.env.APP_ENV = 'development';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TRANSCRIPTION_PROVIDER = 'whisper';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.AI_PROVIDER = 'claude';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.COACHING_CUE_MAX_WORDS = '25';
process.env.QUALITY_GATE_ENABLED = 'true';
process.env.QUALITY_GATE_RETRY_LIMIT = '2';
process.env.MAX_RECORDING_SECONDS = '90';
process.env.MIN_RECORDING_SECONDS = '20';

// AsyncStorage has a native module; use the package's official Jest mock so the
// Supabase client (which persists auth tokens via AsyncStorage) loads cleanly.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-file-system has a native module; provide a light mock for tests. The
// Gemini transcription provider only uses it on the native path (tests stub it).
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn(async () => ''),
  EncodingType: { Base64: 'base64' },
}));

// expo-web-browser / expo-linking are native; mock so AuthService (OAuth) loads.
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
  maybeCompleteAuthSession: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  createURL: (path) => `flowlog://${path}`,
}));

// expo-notifications has native modules; provide a default mock so any file that
// imports NotificationService loads. Individual tests can override scheduling
// behaviour as needed.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'notif-id'),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  // Mirrors the real enum the scheduler's trigger objects reference.
  SchedulableTriggerInputTypes: { CALENDAR: 'calendar' },
}));

// react-native-reanimated 3.10's bundled mock is broken (./src/mock not shipped),
// so provide a minimal mock covering exactly the APIs the app uses. Animations
// become no-ops in tests; useReducedMotion reports false.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props, ref) =>
        React.createElement(View, { ...props, ref }),
      ),
      createAnimatedComponent: (Component) => Component,
    },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    withTiming: (v) => v,
    withRepeat: (v) => v,
    withSequence: (...vals) => vals[vals.length - 1],
    withDelay: (_d, v) => v,
    cancelAnimation: () => {},
    useReducedMotion: () => false,
    Easing: {
      linear: (t) => t,
      ease: (t) => t,
      out: () => (t) => t,
      inOut: () => (t) => t,
      bezier: () => (t) => t,
    },
  };
});
