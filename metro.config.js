const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

/**
 * Force zustand to resolve to CommonJS on web.
 *
 * SDK 54's Metro honours package `exports` maps. zustand ships `react-native`
 * (CJS) and `import`/`module` (ESM) conditions; on web Metro picks the ESM
 * build, which contains a dev-mode warning guarded by `import.meta.env`.
 *
 * `import.meta` is a SYNTAX error in a classic script, and Expo's web output
 * is loaded as one. So it does not merely break the store — the whole bundle
 * fails to parse and the page renders blank, with no clue in the DOM. The only
 * signal is a console SyntaxError.
 *
 * This has been broken since the SDK 54 upgrade. It surfaced only now because
 * the web bundle had never been deployed before the review bench (#77).
 *
 * Scoped deliberately: package exports stay ON everywhere else, and this only
 * applies to web. Disabling them globally would change resolution for every
 * dependency to fix one.
 */
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = baseResolveRequest ?? context.resolveRequest;
  if (platform === 'web' && /^zustand(\/|$)/.test(moduleName)) {
    return resolve(
      { ...context, unstable_enablePackageExports: false },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
