#!/usr/bin/env node
/**
 * A blind review sheet: Gemini's record beside the local one, unlabelled.
 *
 *   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --sample 20
 *   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --sample 20 --html
 *   scripts/experiments/blind-compare.sh ~/flowlog-records-q32 --key
 *
 * Costs nothing. Runs no model.
 *
 * Every number in `record-quality.sh` and `record-agreement.sh` is mechanical.
 * They establish that local records are well-formed, honestly quoted and
 * scoped — they cannot establish that a record TEACHES THE RIGHT THING. Only a
 * person who knows jiu-jitsu can say that, and the whole point of committing
 * to local mining is that nobody will read 800 volumes. So read twenty pairs.
 *
 * Blind on purpose. Knowing which side is the paid model decides the question
 * before the reading starts, and the honest answer here is genuinely in doubt:
 * the two models agree on the moment only about 42% of the time, and where
 * they disagree they are usually both right about different things. A labelled
 * sheet would measure loyalty to Gemini rather than quality.
 *
 * Pairs are matched on position and timestamp, so both sides describe the same
 * moment of the same video and the comparison is fair. Sides are shuffled per
 * pair by a seeded coin, and `--key` prints the answers afterwards.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { MinedRecord } from '../mining/records.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (f: string) => process.argv.includes(f);

const MOMENT_WINDOW = 60;

/**
 * Deterministic shuffle. The sheet and the key must agree about which side is
 * which, and they are produced by separate runs — so the coin is derived from
 * the pair's own id rather than from `Math.random`.
 */
function coin(seed: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) & 1) === 1;
}

function load(dir: string): Map<string, MinedRecord[]> {
  const out = new Map<string, MinedRecord[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.records.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out.set(
      f.replace(/\.records\.json$/, ''),
      Array.isArray(raw) ? raw : (raw.records ?? []),
    );
  }
  return out;
}

interface Pair {
  slug: string;
  position: string;
  timestamp: string;
  gemini: MinedRecord;
  local: MinedRecord;
}

/** One pair per Gemini record that has a local counterpart at the same moment. */
function pairs(
  ref: Map<string, MinedRecord[]>,
  cand: Map<string, MinedRecord[]>,
): Pair[] {
  const out: Pair[] = [];
  for (const [slug, refRecs] of ref) {
    const candRecs = cand.get(slug);
    if (!candRecs) continue;
    const used = new Set<number>();
    for (const r of refRecs) {
      let best = { i: -1, d: Infinity };
      candRecs.forEach((c, i) => {
        if (used.has(i) || c.position !== r.position) return;
        const d = Math.abs(c.source.startSeconds - r.source.startSeconds);
        if (d <= MOMENT_WINDOW && d < best.d) best = { i, d };
      });
      if (best.i === -1) continue;
      used.add(best.i);
      out.push({
        slug,
        position: r.position,
        timestamp: r.source.timestamp,
        gemini: r,
        local: candRecs[best.i]!,
      });
    }
  }
  return out;
}

/** Evenly spaced rather than random: one volume must not dominate the sheet. */
function sample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, i) => xs[Math.floor(i * step)]!);
}

function card(r: MinedRecord, label: string): string {
  const p = r.preconditions;
  return [
    `  ### ${label}`,
    `  prescription : ${r.prescription}`,
    `  why          : ${r.why}`,
    `  detail       : ${r.detail || '(empty)'}`,
    `  counter      : ${r.counter || '(empty)'}`,
    `  applies when : ${p.opponent || '(unconditional)'}`,
    `  gi / level   : ${p.gi} / ${p.level}`,
    `  quote        : "${r.quote}"${r.quoteRepaired ? '   [trimmed to a verbatim span]' : ''}`,
  ].join('\n');
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The same sheet as a local HTML page: click a verdict, it remembers, and the
 * tally only unlocks once every pair is judged.
 *
 * Deliberately a FILE and never a published artifact. These cards quote
 * instructional transcripts verbatim, which is exactly the text
 * `~/flowlog-records` is kept outside the repo to contain and `publish.sh`
 * refuses to ship. Rendering it locally is fine; putting it on a URL is the
 * thing the whole two-store split exists to prevent.
 *
 * The answer key is embedded but revealed only after the last verdict, because
 * the point of the exercise is a judgement made without it.
 */
function renderHtml(
  pairs: Pair[],
  refLabel: string,
  candLabel: string,
): string {
  const cards = pairs
    .map((p, i) => {
      const flipped = coin(`${p.slug}#${p.timestamp}#${p.position}`);
      const [a, b] = flipped ? [p.local, p.gemini] : [p.gemini, p.local];
      const side = (r: MinedRecord, letter: string) => `
        <div class="side">
          <div class="side-h">${letter}</div>
          <dl>
            <dt>prescription</dt><dd class="lead">${esc(r.prescription)}</dd>
            <dt>why</dt><dd>${esc(r.why) || '<i>empty</i>'}</dd>
            <dt>detail</dt><dd>${esc(r.detail) || '<i>empty</i>'}</dd>
            <dt>counter</dt><dd>${esc(r.counter) || '<i>empty</i>'}</dd>
            <dt>applies when</dt><dd>${esc(r.preconditions.opponent) || '<i>unconditional</i>'}</dd>
            <dt>gi / level</dt><dd>${esc(r.preconditions.gi)} / ${esc(r.preconditions.level)}</dd>
          </dl>
          <blockquote>${esc(r.quote)}${r.quoteRepaired ? '<span class="tag">trimmed to a verbatim span</span>' : ''}</blockquote>
        </div>`;
      return `
      <section class="pair" id="p${i}" data-flipped="${flipped}">
        <header><span class="num">${i + 1}</span><b>${esc(p.position)}</b><span class="ts">${esc(p.timestamp)}</span></header>
        <div class="sides">${side(a, 'A')}${side(b, 'B')}</div>
        <div class="verdict" data-i="${i}">
          <button value="A">A better</button>
          <button value="B">B better</button>
          <button value="EQUAL">Equal</button>
          <button value="BAD">Both bad</button>
          <span class="answer"></span>
        </div>
      </section>`;
    })
    .join('\n');

  const key = pairs.map((p) => coin(`${p.slug}#${p.timestamp}#${p.position}`));

  return `<title>Blind record review</title>
<style>
  :root{--bg:#fbfbfa;--fg:#1a1a19;--mut:#6b6b66;--line:#e3e3df;--card:#fff;--acc:#2f6f4f;--warn:#8a5a00}
  @media (prefers-color-scheme:dark){:root{--bg:#16171a;--fg:#e8e8e6;--mut:#9a9a94;--line:#2c2e33;--card:#1e2024;--acc:#7fc9a0;--warn:#d9a441}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 20px 120px}
  h1{font-size:1.5rem;margin:0 0 6px}
  .sub{color:var(--mut);margin:0 0 22px}
  .intro{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:28px}
  .intro ol{margin:8px 0 0;padding-left:20px}
  .intro li{margin:4px 0}
  .pair{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 22px;overflow:hidden}
  .pair header{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line)}
  .num{background:var(--fg);color:var(--bg);border-radius:50%;width:26px;height:26px;display:grid;place-items:center;font-size:.8rem;font-weight:700;flex:none}
  .ts{margin-left:auto;color:var(--mut);font-variant-numeric:tabular-nums;font-size:.85rem}
  .sides{display:grid;grid-template-columns:1fr 1fr}
  @media(max-width:820px){.sides{grid-template-columns:1fr}}
  .side{padding:14px 18px}
  .side+.side{border-left:1px solid var(--line)}
  @media(max-width:820px){.side+.side{border-left:0;border-top:1px solid var(--line)}}
  .side-h{font-weight:700;color:var(--mut);letter-spacing:.08em;font-size:.75rem;margin-bottom:8px}
  dl{margin:0}
  dt{font-size:.68rem;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);margin-top:9px}
  dd{margin:2px 0 0}
  dd.lead{font-weight:600}
  dd i{color:var(--mut)}
  blockquote{margin:12px 0 0;padding:9px 12px;border-left:3px solid var(--acc);background:rgba(127,201,160,.09);font-size:.9rem;border-radius:0 6px 6px 0}
  .tag{display:block;margin-top:6px;font-size:.7rem;color:var(--warn)}
  .verdict{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line);flex-wrap:wrap;align-items:center}
  .verdict button{font:inherit;font-size:.85rem;padding:6px 14px;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:999px;cursor:pointer}
  .verdict button:hover{border-color:var(--acc)}
  .verdict button[aria-pressed=true]{background:var(--acc);border-color:var(--acc);color:#fff}
  @media (prefers-color-scheme:dark){.verdict button[aria-pressed=true]{color:#10231a}}
  .answer{margin-left:auto;font-size:.8rem;color:var(--mut)}
  .bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 20px;display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}
  .bar progress{width:220px}
  .bar button{font:inherit;padding:7px 16px;border-radius:8px;border:1px solid var(--acc);background:var(--acc);color:#fff;cursor:pointer}
  .bar button[disabled]{opacity:.4;cursor:not-allowed}
  #tally{max-width:1180px;margin:0 auto 40px;padding:0 20px;display:none}
  #tally table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  #tally td,#tally th{padding:10px 14px;border-bottom:1px solid var(--line);text-align:left}
  #tally th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
  .win{color:var(--acc);font-weight:700}
</style>
<div class="wrap">
  <h1>Blind record review</h1>
  <p class="sub">${pairs.length} pairs · same moment of the same video · sides shuffled per pair</p>
  <div class="intro">
    <b>Decide a rule before you start</b> — e.g. <i>if the local model wins or ties on 14 of ${pairs.length}, it is good enough to mine with.</i>
    <ol>
      <li><b>Does the card match its quote?</b> Read the quote first, then the prescription. This is the ten-second check the review bench runs.</li>
      <li><b>Is the mechanic correct and specific enough to act on?</b></li>
      <li><b>Does “applies when” actually scope it?</b> An absolute with no scope is the #102 bug.</li>
    </ol>
    <p style="margin:10px 0 0;color:var(--mut);font-size:.9rem">Use <b>Both bad</b> freely — it is the most informative verdict and the one no metric can produce. Longer quotes and “…” tend to mark one side; if you notice yourself pattern-matching on that, your preference is no longer blind.</p>
  </div>
${cards}
</div>
<div id="tally"><h2>Result</h2><table id="tallyTable"></table></div>
<div class="bar">
  <progress id="prog" max="${pairs.length}" value="0"></progress>
  <span id="count">0 / ${pairs.length}</span>
  <button id="reveal" disabled>Reveal which was which</button>
  <button id="reset" style="background:transparent;color:var(--fg);border-color:var(--line)">Reset</button>
</div>
<script>
  const KEY = ${JSON.stringify(key)};            // true = A was LOCAL
  const REF = ${JSON.stringify(refLabel)}, CAND = ${JSON.stringify(candLabel)};
  const N = ${pairs.length};
  const STORE = 'blind-review-' + N;
  let votes = {};
  try { votes = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { votes = {}; }

  function save(){ try { localStorage.setItem(STORE, JSON.stringify(votes)); } catch (e) {} }
  function paint(){
    document.querySelectorAll('.verdict').forEach(v => {
      const i = v.dataset.i;
      v.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(votes[i] === b.value)));
    });
    const n = Object.keys(votes).length;
    document.getElementById('prog').value = n;
    document.getElementById('count').textContent = n + ' / ' + N;
    document.getElementById('reveal').disabled = n < N;
  }
  document.querySelectorAll('.verdict').forEach(v => {
    v.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const i = v.dataset.i;
      votes[i] === b.value ? delete votes[i] : votes[i] = b.value;
      save(); paint();
    });
  });
  document.getElementById('reset').onclick = () => { votes = {}; save(); paint();
    document.getElementById('tally').style.display = 'none';
    document.querySelectorAll('.answer').forEach(a => a.textContent = ''); };
  document.getElementById('reveal').onclick = () => {
    let local = 0, gem = 0, eq = 0, bad = 0;
    document.querySelectorAll('.verdict').forEach(v => {
      const i = +v.dataset.i, aIsLocal = KEY[i], vote = votes[i];
      const winner = vote === 'A' ? (aIsLocal ? 'local' : 'gemini')
                   : vote === 'B' ? (aIsLocal ? 'gemini' : 'local') : vote;
      if (winner === 'local') local++; else if (winner === 'gemini') gem++;
      else if (vote === 'EQUAL') eq++; else if (vote === 'BAD') bad++;
      v.querySelector('.answer').textContent =
        'A = ' + (aIsLocal ? CAND : REF) + '  ·  B = ' + (aIsLocal ? REF : CAND);
    });
    const rows = [['local (' + CAND + ')', local], [REF, gem], ['equal', eq], ['both bad', bad]];
    const best = Math.max(local, gem);
    document.getElementById('tallyTable').innerHTML =
      '<tr><th>verdict</th><th>count</th></tr>' + rows.map(function(r){
        var hl = (r[1] === best && best > 0 && (r[0].indexOf('local') === 0 || r[0] === REF));
        return '<tr><td>' + r[0] + '</td><td class="' + (hl ? 'win' : '') + '">' + r[1] + '</td></tr>';
      }).join('');
    document.getElementById('tally').style.display = 'block';
    document.getElementById('tally').scrollIntoView({behavior:'smooth'});
  };
  paint();
</script>`;
}

function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error(
      'usage: blind-compare.sh <local-records-dir> [--reference DIR] [--sample N] [--key] [--out FILE]',
    );
    process.exit(1);
  }
  const candDir = resolve(dir);
  if (!existsSync(candDir)) {
    console.error(`error: no such directory ${candDir}`);
    process.exit(1);
  }
  // The reference defaults to the mined corpus, but a fair sheet needs BOTH
  // sides produced by the current prompt — the corpus was mined by an older
  // one, and comparing against it would score the prompt change rather than
  // the model.
  const refDir = resolve(
    arg('--reference') ?? join(homedir(), 'flowlog-records'),
  );
  if (!existsSync(refDir)) {
    console.error(`error: no such reference directory ${refDir}`);
    process.exit(1);
  }
  const ref = load(refDir);
  const all = pairs(ref, load(candDir));
  const n = Number(arg('--sample') ?? '20');
  const chosen = sample(all, n);

  if (has('--key')) {
    console.error(
      `\nANSWER KEY — ${basename(candDir)} vs ${basename(refDir)}\n`,
    );
    chosen.forEach((p, i) => {
      const flipped = coin(`${p.slug}#${p.timestamp}#${p.position}`);
      console.error(
        `  ${String(i + 1).padStart(3)}.  A = ${flipped ? 'LOCAL ' : 'GEMINI'}   ` +
          `B = ${flipped ? 'GEMINI' : 'LOCAL '}   ${p.slug} @${p.timestamp}`,
      );
    });
    console.error('');
    return;
  }

  const lines: string[] = [
    `BLIND REVIEW SHEET — ${chosen.length} of ${all.length} matched pairs`,
    '',
    'Both cards in a pair describe the SAME moment of the SAME video. One was',
    'written by the paid model, one by the local model, in a different order',
    'each time. For each pair mark A, B, EQUAL, or BOTH BAD.',
    '',
    'What to judge — in this order:',
    '  1. Does the card match its quote? (the ten-second check)',
    '  2. Is the mechanic correct and specific enough to act on?',
    '  3. Does "applies when" actually scope it?',
    '',
    `Reference: ${basename(refDir)}    Candidate: ${basename(candDir)}`,
    'Run with --key afterwards to reveal which side was which.',
    '',
    '='.repeat(72),
  ];

  chosen.forEach((p, i) => {
    const flipped = coin(`${p.slug}#${p.timestamp}#${p.position}`);
    const [a, b] = flipped ? [p.local, p.gemini] : [p.gemini, p.local];
    lines.push(
      '',
      `## ${i + 1}.  ${p.position}   @${p.timestamp}`,
      '',
      card(a, 'A'),
      '',
      card(b, 'B'),
      '',
      '  verdict: [ A / B / EQUAL / BOTH BAD ]    notes:',
      '',
      '-'.repeat(72),
    );
  });

  if (has('--html')) {
    const htmlOut =
      arg('--out') ?? join(homedir(), 'flowlog-records', 'blind-review.html');
    writeFileSync(
      htmlOut,
      renderHtml(chosen, basename(refDir), basename(candDir)),
      'utf8',
    );
    console.error(
      `\n${chosen.length} of ${all.length} pairs written to:\n  ${htmlOut}\n`,
    );
    console.error(
      `Open it and judge. The tally unlocks after the last pair.\n`,
    );
    return;
  }

  const out =
    arg('--out') ?? join(homedir(), 'flowlog-records', 'blind-review.txt');
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.error(`\n${chosen.length} pairs written to:\n  ${out}\n`);
  console.error(`Matched pairs available: ${all.length}`);
  // Echo the FULL command including --reference: the key must be generated
  // from the same pair set, and omitting the reference silently reveals a
  // different sheet's answers.
  const refFlag = arg('--reference')
    ? ` --reference ${arg('--reference')}`
    : '';
  console.error(
    `Reveal with:  scripts/experiments/blind-compare.sh ${dir}${refFlag} --sample ${n} --key\n`,
  );
}

main();
