# 0009. Pin Metro 0.80.9, NativeWind 4.0.36, Reanimated 3.10.1

**Status:** deprecated — applied only to Expo SDK 51 / RN 0.74; superseded by the
SDK 54 toolchain (see `docs/SDK54_UPGRADE.md` and the toolchain note in
`CLAUDE.md`). · **Date:** 2026-06-14

Pinned `metro@0.80.9` (via `overrides` + direct devDeps), `nativewind@4.0.36`,
and `react-native-reanimated@~3.10.1` — the Expo SDK 51 / RN 0.74 compatible
versions. npm otherwise hoisted newer transitive versions that broke the build:
Metro 0.84 moved the `TerminalReporter` export that `@expo/cli` imports, and
NativeWind 4.2.x shipped a css-interop built for the New Architecture requiring
`react-native-worklets` (peer `react-native@0.83+`), incompatible with RN 0.74.
The pins were validated end-to-end with `expo export` (1090 modules bundled) and
the committed `package-lock.json` locked the full verified tree.

> **Superseded:** the SDK 54 migration removed the `metro@0.80.9` overrides
> (SDK 54 needs Metro 0.83) and moved Reanimated/NativeWind forward. Do not
> reapply these pins on SDK 54+; follow `docs/SDK54_UPGRADE.md`.

## Consequences

- These pins had to be consciously re-verified on every Expo SDK upgrade — which
  is exactly what retired this decision.

## Considered options

- **Letting npm resolve latest** — rejected: produced a tree that failed to
  bundle.
- **Using `expo install` to auto-align** — correct in principle, but the same
  pins still had to land in `package.json` for reproducible CI installs.
