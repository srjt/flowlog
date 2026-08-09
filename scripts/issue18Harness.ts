// #18 harness — orchestrator. Proves the cue -> spec -> render loop end to end
// across several DIFFERENT cues per position, so the black-belt panel can rate
// real output against the (b) never-misleading floor / (a) expert-correct head.
//
//   Real LLM specs (needs a key exported in the shell):
//     GEMINI_API_KEY=... node scripts/issue18Harness.ts
//   Offline (hand-authored golden specs, no key — verifies validation+render):
//     node scripts/issue18Harness.ts --offline
//   Options: --model <id>  --position <seed-id>  --out <path>
//
// Runs on Node 24 (type-stripping). Auto-loads .env like the other spikes.
// Writes an HTML gallery to spike/issue18-force-diagrams.html.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import {
  GRAMMAR_VERSION,
  type Spec,
  validateSpec,
} from './issue18/grammar.ts';
import { type Position, roleNames } from './issue18/keypoints.ts';
import { PAGE_CSS, renderDiagramSvg } from './issue18/renderer.ts';
import {
  SPEC_PROMPT_VERSION,
  type SpecResult,
  offlineSpec,
  requestSpec,
} from './issue18/specStage.ts';

const BASE_LIBRARY_VERSION = '0.1.0'; // version of the seed authoring set

// ── .env autoload (publishable EXPO_PUBLIC_* only; secrets from the shell) ──
try {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env */
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const OFFLINE = args.includes('--offline');
const MODEL =
  flag('--model') ||
  process.env.GEMINI_TEXT_MODEL ||
  process.env.EXPO_PUBLIC_GEMINI_MODEL ||
  'gemini-2.5-flash';
const KEY = process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const ONLY = flag('--position');
const OUT = flag('--out') || 'spike/issue18-force-diagrams.html';

const seedUrl = (name: string) => new URL(`./issue18/seed/${name}`, import.meta.url);

function loadSeeds(): Position[] {
  const dir = new URL('./issue18/seed/', import.meta.url);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.json') && f !== 'reference-specs.json',
  );
  const positions = files.map(
    (f) => JSON.parse(readFileSync(seedUrl(f), 'utf8')) as Position & { cues: Cue[] },
  );
  positions.sort((a, b) => a.id.localeCompare(b.id));
  return positions;
}

interface Cue {
  id: string;
  text: string;
}

function loadRefSpecs(): Record<string, Record<string, Spec['annotations']>> {
  return JSON.parse(readFileSync(seedUrl('reference-specs.json'), 'utf8'));
}

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));

interface Cell {
  cue: Cue;
  result: SpecResult | null;
  svg: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  error?: string; // stage-level failure (LLM/network)
}

async function specFor(
  pos: Position,
  cue: Cue,
  refSpecs: Record<string, Record<string, Spec['annotations']>>,
): Promise<{ result: SpecResult | null; error?: string }> {
  if (OFFLINE) {
    const r = offlineSpec(refSpecs, pos, cue.id);
    return r
      ? { result: r }
      : { result: null, error: `no offline golden spec for ${pos.id}/${cue.id}` };
  }
  try {
    return { result: await requestSpec(pos, cue.text, { apiKey: KEY, model: MODEL }) };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function main() {
  if (!OFFLINE && !KEY) {
    console.error(
      '\n❌ No GEMINI_API_KEY. Export it in the shell for a real run, or pass --offline\n' +
        '   to render the hand-authored golden specs (validation + renderer only).\n',
    );
    process.exit(1);
  }

  const seeds = loadSeeds().filter((p) => !ONLY || p.id === ONLY);
  if (seeds.length === 0) {
    console.error(`\n❌ No seed positions${ONLY ? ` matching "${ONLY}"` : ''}.\n`);
    process.exit(1);
  }
  const refSpecs = loadRefSpecs();

  console.log(
    `\n#18 harness — ${OFFLINE ? 'OFFLINE (golden specs)' : `LLM (${MODEL})`}\n` +
      `grammar ${GRAMMAR_VERSION} · seeds ${BASE_LIBRARY_VERSION} · specPrompt ${SPEC_PROMPT_VERSION}\n`,
  );

  const tally = { rendered: 0, invalid: 0, failed: 0 };
  const sections: string[] = [];
  let idx = 0;

  for (const pos of seeds) {
    const cues = (pos as Position & { cues: Cue[] }).cues ?? [];
    const known = roleNames(pos);
    console.log(`── ${pos.label} (${cues.length} cues) ──`);
    const cells: Cell[] = [];

    for (const cue of cues) {
      const { result, error } = await specFor(pos, cue, refSpecs);
      if (!result) {
        console.log(`   ⚠️  ${cue.id.padEnd(18)} FAILED — ${error}`);
        tally.failed++;
        cells.push({ cue, result: null, svg: '', valid: false, errors: [], warnings: [], error });
        continue;
      }
      const v = validateSpec(result.spec, known);
      let svg = '';
      if (v.valid) {
        try {
          svg = renderDiagramSvg(pos, result.spec, idx++);
        } catch (e) {
          v.errors.push(`render error: ${(e as Error).message}`);
        }
      }
      const ok = v.valid && svg !== '';
      tally[ok ? 'rendered' : 'invalid']++;
      console.log(
        `   ${ok ? '✅' : '❌'} ${cue.id.padEnd(18)} ${result.source}` +
          ` — ${result.spec.annotations.length} annotations` +
          (v.errors.length ? ` · ${v.errors.length} error(s)` : ''),
      );
      cells.push({ cue, result, svg, valid: ok, errors: v.errors, warnings: v.warnings });
    }
    sections.push(renderSection(pos, cells));
    console.log();
  }

  const html = renderPage(sections, {
    mode: OFFLINE ? 'offline' : `llm:${MODEL}`,
  });
  const outUrl = new URL(`../${OUT}`, import.meta.url);
  writeFileSync(outUrl, html);

  console.log(
    `Summary — rendered ${tally.rendered}, invalid ${tally.invalid}, failed ${tally.failed}.`,
  );
  console.log(`Wrote ${OUT}\n   open ${OUT}\n`);
}

function renderSection(pos: Position, cells: Cell[]): string {
  const cards = cells
    .map((c) => {
      const badge = c.result
        ? c.valid
          ? `<span class="badge ok">valid</span>`
          : `<span class="badge bad">invalid</span>`
        : `<span class="badge bad">no spec</span>`;
      const src = c.result ? `<span class="src">${c.result.source}${c.result.model ? ` · ${c.result.model}` : ''}</span>` : '';
      const specJson = c.result ? esc(JSON.stringify(c.result.spec, null, 2)) : '';
      const errs =
        c.errors.length || c.error
          ? `<div class="errs">${esc([c.error ?? '', ...c.errors].filter(Boolean).join(' · '))}</div>`
          : '';
      const body = c.svg || placeholderSvg(c.error || c.errors.join('; ') || 'no diagram');
      return (
        `<div class="card"><div class="fd">${body}</div>` +
        `<div class="meta"><div class="cueid">${esc(c.cue.id)} ${badge}${src}</div>` +
        `<div class="cuetext">${esc(c.cue.text)}</div>${errs}` +
        (specJson
          ? `<details><summary>spec</summary><pre>${specJson}</pre></details>`
          : '') +
        `</div></div>`
      );
    })
    .join('');
  return `<h2 class="posh">${esc(pos.label)} <span class="src">${esc(pos.id)}</span></h2><div class="grid">${cards}</div>`;
}

function placeholderSvg(msg: string): string {
  return `<svg viewBox="0 0 820 520" role="img" xmlns="http://www.w3.org/2000/svg"><rect width="820" height="520" fill="var(--panel)"/><text x="410" y="260" text-anchor="middle" font-size="18" fill="var(--muted)" font-family="ui-sans-serif, system-ui, sans-serif">below floor → text-only cue</text><text x="410" y="288" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="ui-sans-serif, system-ui, sans-serif">${esc(msg.slice(0, 80))}</text></svg>`;
}

function renderPage(sections: string[], meta: { mode: string }): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>#18 — cue → spec → render harness</title><style>${PAGE_CSS}</style></head><body>` +
    `<div class="wrap"><h1>Cue → spec → render — #18 prototype</h1>` +
    `<p class="sub">Each card is a real diagram drawn <strong>deterministically from a structured spec</strong> ` +
    `(annotation over generation). Several different cues per position show the cue actually <strong>changes</strong> ` +
    `the diagram. Grey = base keypoint skin; colour = overlay resolved from the spec's semantic roles. ` +
    `Mode: <code>${esc(meta.mode)}</code>. See the spec under each card. ` +
    `Rate each against the bar: (b) never-misleading floor, (a) expert-correct head.</p>` +
    sections.join('') +
    `</div></body></html>`
  );
}

main().catch((e) => {
  console.error(`\n❌ ${e?.stack ?? e}\n`);
  process.exit(1);
});
