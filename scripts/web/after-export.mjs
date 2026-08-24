/**
 * Post-export check for the web build (#77).
 *
 * `expo export` does not fail when the SPA fallback is missing — it just
 * produces a dist/ that 404s on every route except "/". Since /review IS the
 * route reviewers are given, that failure would only show up in front of the
 * people whose time this is meant to save.
 */
import { existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
let failed = false;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('  ✗ dist/index.html missing — the export did not produce an SPA.');
  failed = true;
}

// Expo copies public/ into dist/, but confirm rather than assume: a silently
// missing _redirects is the whole failure mode this script exists to catch.
if (!existsSync(join(DIST, '_redirects'))) {
  if (existsSync(join('public', '_redirects'))) {
    copyFileSync(join('public', '_redirects'), join(DIST, '_redirects'));
    console.error('  · copied public/_redirects into dist/');
  } else {
    console.error('  ✗ _redirects missing — /review will 404 on Cloudflare Pages.');
    failed = true;
  }
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const p = join(dir, entry.name);
    return total + (entry.isDirectory() ? size(p) : statSync(p).size);
  }, 0);

if (!failed) {
  console.error(`
  Web build ready — ${(size(DIST) / 1e6).toFixed(1)} MB in dist/

  Upload dist/ to Cloudflare Pages. Deliberately a manual step: this repo is
  public and merges are frequent, so git-integrated auto-deploy would publish
  whatever master happens to be mid-refactor.

  Reviewers go to  <your-pages-domain>/review
  See docs/REVIEW_BENCH.md for inviting them.
`);
}

process.exit(failed ? 1 : 0);
