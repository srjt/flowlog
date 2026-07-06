const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// --- react-native-worklets Bundle Mode -------------------------------------
// Enabled to stop worklet source from being re-parsed at runtime, which is what
// crashes the app at launch on physical iOS 26 devices (see babel.config.js and
// reanimated#9443 / expo#44606 / react-native#54859).
//
// worklets 0.5.1 ships `bundleModeMetroConfig`, but its helper hard-requires
// `@react-native/metro-config`, which an Expo project does not install — so we
// compose the equivalent config against Expo's own default config here. Mirrors
// node_modules/react-native-worklets/bundleMode/index.js.
const workletsNodeModulesDir = path.resolve(
  require.resolve('react-native-worklets/package.json'),
  '../..'
);

const baseGetModulesRunBeforeMainModule =
  config.serializer.getModulesRunBeforeMainModule ?? (() => []);

config.serializer.getModulesRunBeforeMainModule = (dirname) => [
  require.resolve('react-native-worklets/src/workletRuntimeEntry.ts'),
  require.resolve('react-native-worklets/lib/module/workletRuntimeEntry.js'),
  ...baseGetModulesRunBeforeMainModule(dirname),
];

config.serializer.createModuleIdFactory = () => {
  let nextId = 0;
  const idFileMap = new Map();
  return (moduleName) => {
    if (idFileMap.has(moduleName)) {
      return idFileMap.get(moduleName);
    }
    // Generated worklet modules carry their numeric id in the filename so the
    // runtime can look them up deterministically.
    if (moduleName.includes('react-native-worklets/__generatedWorklets/')) {
      const id = Number(path.basename(moduleName, '.js'));
      idFileMap.set(moduleName, id);
      return id;
    }
    idFileMap.set(moduleName, nextId++);
    return idFileMap.get(moduleName);
  };
};

const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('react-native-worklets/__generatedWorklets/')) {
    return {
      type: 'sourceFile',
      filePath: path.join(workletsNodeModulesDir, moduleName),
    };
  }
  return (baseResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform
  );
};
// ---------------------------------------------------------------------------

module.exports = withNativeWind(config, { input: './global.css' });
