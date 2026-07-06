const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'Xcode 26 fmt consteval workaround';

// react_native_post_install(...) is called inside our generated Podfile's
// post_install block. Match from the call's name through to ITS OWN closing
// paren (the first standalone ")" on its own line) -- non-greedy so it can't
// swallow anything past that single call.
const CALL_PATTERN = /react_native_post_install\(\s*installer,[\s\S]*?\n\s*\)/;

function buildPatch() {
  return `
    # ${MARKER} (see docs/SDK54_UPGRADE.md) -- Apple Clang shipped with newer
    # Xcode enforces stricter consteval rules than fmt 11.0.2's FMT_STRING
    # macro expects, breaking buildReactNativeFromSource builds with:
    #   call to consteval function '...' is not a constant expression
    # Disabling FMT_USE_CONSTEVAL falls back to fmt's safe runtime
    # format-string validation. Remove once RN bundles a fmt version that
    # handles newer Apple Clang (facebook/react-native already fixed this
    # upstream; expo/expo#44229 tracks the SDK release).
    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      fmt_base_content = File.read(fmt_base)
      patched = fmt_base_content.gsub(/^(#\\s*define FMT_USE_CONSTEVAL) 1$/, '\\1 0')
      if patched != fmt_base_content
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
      end
    end
`;
}

/**
 * expo-build-properties' buildReactNativeFromSource compiles fmt from source,
 * which fails under Xcode 26's stricter consteval checking (see
 * docs/SDK54_UPGRADE.md). This patches the generated Podfile's post_install
 * hook to disable fmt's compile-time format-string checking after CocoaPods
 * installs it, since there's no committed ios/ directory to edit directly --
 * expo prebuild regenerates the Podfile on every EAS build.
 */
function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile',
      );
      const content = fs.readFileSync(podfilePath, 'utf-8');
      if (content.includes(MARKER)) return config;

      const match = content.match(CALL_PATTERN);
      if (!match) {
        throw new Error(
          'withFmtConstevalFix: expected react_native_post_install(...) call ' +
            'not found in the generated Podfile -- the Expo prebuild template ' +
            'changed shape, update plugins/withFmtConstevalFix.js to match it.',
        );
      }

      const patched = content.replace(
        CALL_PATTERN,
        (call) => call + buildPatch(),
      );
      fs.writeFileSync(podfilePath, patched);
      return config;
    },
  ]);
}

module.exports = withFmtConstevalFix;
