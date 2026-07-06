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
  //
  // bundleMode: worklets are serialized into the Metro bundle at build time
  // instead of having their source re-parsed at runtime by valueUnpacker. On
  // physical iOS 26 devices that runtime parse hits a `callGuardDEV` symbol and
  // throws a Hermes SyntaxError, which propagates as an unhandled C++ exception
  // through ObjCTurboModule::performVoidMethodInvocation and SIGABRTs at launch
  // (the crash simulators never see). Turning off runtime parsing removes the
  // trigger. Pairs with the bundle-mode Metro config in metro.config.js.
  // Refs: reanimated#9443, expo#44606, react-native#54859.
  const plugins = isTest
    ? []
    : [['react-native-worklets/plugin', { bundleMode: true }]];

  return { presets, plugins };
};
