module.exports = function (api) {
  // Cache key varies by NODE_ENV so test vs app builds get the right presets.
  const isTest = api.cache.using(() => process.env.NODE_ENV === 'test');

  // Under Jest we only transform TS/JS for logic tests — NativeWind's Babel
  // preset pulls in Reanimated (which needs react-native-worklets) and isn't
  // needed for non-rendering tests. App builds (metro/expo) keep NativeWind.
  const presets = isTest
    ? ['babel-preset-expo']
    : [
        ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
        'nativewind/babel',
      ];

  // Reanimated 4 moved its worklet transform into react-native-worklets.
  // This plugin MUST be listed last. Skipped under Jest (no rendering/worklets).
  // Bundle Mode was REMOVED with worklets 0.8.3: the 0.5.1 valueUnpacker's
  // broken `callGuardDEV` reference (the physical-iOS-26 launch crash) is gone
  // from 0.8.x, so the default runtime path is safe again. History + fallback:
  // docs/SDK54_UPGRADE.md.
  const plugins = isTest ? [] : [['react-native-worklets/plugin']];

  return { presets, plugins };
};
