/**
 * Every `{{PLACEHOLDER}}` in a sport prompt must be supplied by every call site
 * that fills that prompt.
 *
 * This exists because omitting one is SILENT. `fillTemplate` replaces only the
 * keys it is handed, so a missing key sends the literal characters
 * `{{GROUNDING}}` to the model, the call succeeds, a cue comes back, and the
 * session row still records `grounding = 'grounded'` with the ids of records
 * that never reached the prompt. That is exactly what happened: `dec9a78`
 * added grounding to the client providers and to the edge function's
 * signature, and never added the key to the edge function's `fillTemplate`
 * call. Every unit test passed, because they all exercise the client.
 *
 * The check is deliberately a SOURCE scan rather than an import. The edge
 * function is Deno (`Deno.env`, `.ts` import specifiers) and cannot be loaded
 * under Jest, which is the same gap that let the bug live — so the test reads
 * the file instead of skipping the file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BJJ_COACHING_PROMPT,
  BJJ_EXTRACTION_PROMPT,
} from '@/sports/bjj/bjjPrompts';
import {
  GOLF_COACHING_PROMPT,
  GOLF_EXTRACTION_PROMPT,
} from '@/sports/golf/golfPrompts';

const ROOT = join(__dirname, '..', '..');

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** `{{FOO}}` occurrences in a prompt template. */
function placeholders(template: string): string[] {
  return [
    ...new Set(
      [...template.matchAll(/\{\{([A-Z][A-Z_]*)\}\}/g)].map((m) => m[1]!),
    ),
  ].sort();
}

/**
 * The keys of the object literal passed to a `fillTemplate` call.
 *
 * `marker` must end at the call's opening `{`; the brace is then matched to
 * find the literal's extent, so a future key whose value contains braces does
 * not truncate the scan.
 */
function filledKeys(source: string, marker: string): string[] {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`call site not found: ${marker}`);
  const open = at + marker.length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unbalanced object literal: ${marker}`);
  const literal = source
    .slice(open, close + 1)
    // Comments may legitimately mention a placeholder they do not supply.
    .replace(/\/\/.*$/gm, '');
  return [
    ...new Set(
      [...literal.matchAll(/(?:^|[,{])\s*([A-Z][A-Z_]*)\s*:/gm)].map(
        (m) => m[1]!,
      ),
    ),
  ].sort();
}

const CALL_SITES = [
  {
    name: 'edge function (production)',
    file: 'supabase/functions/_shared/ai.ts',
    coaching: 'fillTemplate(sport.coachingPrompt, {',
    extraction: 'fillTemplate(sport.extractionPrompt, {',
  },
  {
    name: 'ClaudeProvider (reference)',
    file: 'src/providers/ai/ClaudeProvider.ts',
    coaching: 'this.fillTemplate(input.sportContext.coachingPrompt, {',
    extraction: 'this.fillTemplate(input.sportContext.extractionPrompt, {',
  },
  {
    name: 'GeminiProvider (reference)',
    file: 'src/providers/ai/GeminiProvider.ts',
    coaching: 'this.fillTemplate(input.sportContext.coachingPrompt, {',
    extraction: 'this.fillTemplate(input.sportContext.extractionPrompt, {',
  },
] as const;

// Every sport's prompts flow through the same call sites, so each site must
// cover the union.
const COACHING_PLACEHOLDERS = placeholders(
  BJJ_COACHING_PROMPT + GOLF_COACHING_PROMPT,
);
const EXTRACTION_PLACEHOLDERS = placeholders(
  BJJ_EXTRACTION_PROMPT + GOLF_EXTRACTION_PROMPT,
);

describe('prompt placeholders are filled at every call site', () => {
  it('the prompts actually declare the placeholders under test', () => {
    // Guards the guard: a typo'd regex that matched nothing would make every
    // assertion below vacuously pass.
    expect(COACHING_PLACEHOLDERS).toContain('GROUNDING');
    expect(COACHING_PLACEHOLDERS).toContain('KEY_MISTAKE');
    expect(EXTRACTION_PLACEHOLDERS).toContain('TRANSCRIPT');
  });

  describe.each(CALL_SITES)('$name', (site) => {
    const source = read(site.file);

    it('fills every coaching placeholder', () => {
      const supplied = filledKeys(source, site.coaching);
      const missing = COACHING_PLACEHOLDERS.filter(
        (p) => !supplied.includes(p),
      );
      expect(missing).toEqual([]);
    });

    it('fills every extraction placeholder', () => {
      const supplied = filledKeys(source, site.extraction);
      const missing = EXTRACTION_PLACEHOLDERS.filter(
        (p) => !supplied.includes(p),
      );
      expect(missing).toEqual([]);
    });
  });
});

describe('the edge function renders grounding, not just receives it', () => {
  const source = read('supabase/functions/_shared/ai.ts');

  it('passes its groundingRecords argument to groundingSection', () => {
    // The precise shape of the original bug: the parameter existed, the import
    // existed, and the value went nowhere.
    expect(source).toContain('GROUNDING: groundingSection(groundingRecords)');
  });

  it('imports groundingSection from the single-sourced module', () => {
    // Not a local copy: the client and the server must build the same prompt,
    // or a cue measured in one place says nothing about the other.
    expect(source).toMatch(
      /import \{ groundingSection \} from '\.\.\/\.\.\/\.\.\/src\/sports\/grounding\.ts'/,
    );
  });
});
