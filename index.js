// Custom entry: install the global crash reporter BEFORE expo-router loads
// any app code, so early module-load failures are readable instead of
// "Unhandled JS Exception: [object Object]". See docs/SDK54_UPGRADE.md.
import './src/utils/errorReporter';
import 'expo-router/entry';
