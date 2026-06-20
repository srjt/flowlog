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

  return { presets };
};
