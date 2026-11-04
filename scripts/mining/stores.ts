/**
 * The canonical review store: the one the live serving store was published
 * from, and the default for every mining and publishing command.
 *
 * One place, so moving it later is a one-line change. Every command keeps its
 * own flag (`--out` for the miners, `--records` for publish and quote repair),
 * and an explicit flag always wins. That is how the model experiments run into
 * their own directories without touching this.
 *
 * Why it is `~/flowlog-records-local-all` and not `~/flowlog-records` (#131):
 * the serving store was re-published from the local re-mine, deliberately (see
 * `docs/LOCAL_MINING.md`), and it holds 5,574 records, matching
 * `flowlog-records-local-all` exactly. The defaults still pointed at
 * `flowlog-records`, the earlier Gemini corpus (1,874 records, a 1,637-entry
 * mapping), so following the written publish steps would have merged that
 * corpus over production. Nine stores exist on the mining machine. The other
 * seven (`-q32`, `-gemma`, `-gemfix`, `-local-chunked`, and so on) are the
 * evidence behind past model comparisons, and they stay exactly where they
 * are. So does `flowlog-records`: it is no longer the default, not deleted.
 *
 * To ask which store is canonical without reading this file:
 *
 *   scripts/mining/publish.sh --which-store
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The canonical store's directory name, under the home directory. */
export const CANONICAL_STORE_DIRNAME = 'flowlog-records-local-all';

export function canonicalStorePath(home: string = homedir()): string {
  return join(home, CANONICAL_STORE_DIRNAME);
}

export type StoreChoice =
  | { ok: true; path: string; isDefault: boolean }
  | { ok: false; path: string; error: string };

/**
 * Pick the store a command uses. Pure: existence is injected.
 *
 * An explicit path is taken as given, existing or not. Mining into a NEW
 * experiment directory is the normal way to run a comparison, and the miner
 * creates it.
 *
 * The default is different. If the canonical store is missing, something is
 * wrong (a typo here, a moved directory, a different machine), and creating
 * an empty store in its place would make the next publish look like a first
 * one. So it fails, and names the path.
 */
export function chooseStore(
  explicit: string | null | undefined,
  canonical: string,
  exists: (path: string) => boolean,
  flag: string,
): StoreChoice {
  if (explicit) return { ok: true, path: resolve(explicit), isDefault: false };
  if (exists(canonical)) return { ok: true, path: canonical, isDefault: true };
  return {
    ok: false,
    path: canonical,
    error:
      `the canonical store does not exist: ${canonical}\n` +
      `  Every mining and publish default points there (scripts/mining/stores.ts).\n` +
      `  It is not created automatically: an empty store in its place would make\n` +
      `  the next publish look like a first one. Restore it, fix the path in\n` +
      `  stores.ts, or pass ${flag} <dir> to use another store on purpose.`,
  };
}

/** `chooseStore` against the real filesystem, exiting on a missing default. */
export function storeOrDie(
  explicit: string | null | undefined,
  flag: string,
): { path: string; isDefault: boolean } {
  const choice = chooseStore(explicit, canonicalStorePath(), existsSync, flag);
  if (!choice.ok) {
    console.error(`error: ${choice.error}`);
    process.exit(1);
  }
  return choice;
}
