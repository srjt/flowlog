#!/usr/bin/env node
/**
 * Replay the frozen baseline through the CURRENT coaching pipeline.
 *
 *   scripts/replay/replay.sh              # all sessions
 *   scripts/replay/replay.sh --limit 10   # a sample
 *
 * Re-runs coaching over the stored extraction of every baseline session and
 * writes the new cue beside the one that shipped. Transcription and extraction
 * are NOT re-run: reusing the stored fields keeps the comparison honest, since
 * the only thing that changed is how the cue is written.
 *
 * This is a comparison aid, not a measurement. Whether a cue is BETTER is a
 * judgement only a practitioner can make (see #35) — this just shows what
 * moved, so that judgement has something to look at.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  candidatePositions,
  groundingSection,
  rankRecords,
} from '../../src/sports/grounding.ts';
import { BJJ_COACHING_PROMPT } from '../../src/sports/bjj/bjjPrompts.ts';

/** The frozen baseline's row shape — snake_case, straight from the database. */
interface BaselineSession {
  id: string;
  coaching_cue: string | null;
  raw_transcript: string | null;
  key_mistake: string | null;
  opponent_action: string | null;
  positions_visited: string[] | null;
  skill_level: string | null;
}

/** A mined record as held in the local review store. */
interface ReviewRecord {
  position: string;
  prescription: string;
  why: string;
  detail: string;
  counter: string;
  preconditions: { gi: string; level: string; opponent: string };
}

function die(m: string): never {
  console.error(`error: ${m}`);
  process.exit(1);
}
function arg(f: string): string | null {
  const i = process.argv.indexOf(f);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function loadDotEnv(): void {
  const p = join(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || !m[1] || process.env[m[1]]) continue;
    const v = (m[2] ?? '').replace(/^['"]|['"]$/g, '').trim();
    if (v) process.env[m[1]] = v;
  }
}

async function coach(
  prompt: string,
  key: string,
  model: string,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Same settings the edge function uses for coaching.
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  if (!res.ok) return `(HTTP ${res.status})`;
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (j.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');
  try {
    return (JSON.parse(text) as { cue?: string }).cue ?? '(no cue field)';
  } catch {
    return '(unparseable response)';
  }
}

async function main() {
  loadDotEnv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) die('GEMINI_API_KEY not set (shell or .env)');
  const model = arg('--model') ?? 'gemini-2.5-flash';
  const limit = Number(arg('--limit') ?? '0');

  const baselinePath = join(homedir(), 'flowlog-baseline', 'baseline.json');
  if (!existsSync(baselinePath)) die(`no frozen baseline at ${baselinePath}`);
  const sessions: BaselineSession[] = JSON.parse(
    readFileSync(baselinePath, 'utf8'),
  );

  const recs: ReviewRecord[] = [];
  const recordsDir = join(homedir(), 'flowlog-records');
  for (const f of readdirSync(recordsDir).filter((f) =>
    f.endsWith('.records.json'),
  )) {
    recs.push(...JSON.parse(readFileSync(join(recordsDir, f), 'utf8')));
  }

  // Skip what the pipeline would now DECLINE (#44). Production never reaches
  // coaching for these, so replaying them would compare a cue that no longer
  // gets written. The word floor is applied here; the model's own sufficiency
  // judgement would decline a few more, so this is the conservative subset.
  const MIN_TRANSCRIPT_WORDS = 8;
  const declined: BaselineSession[] = [];
  const usable = sessions.filter((s) => {
    if (!(s.coaching_cue ?? '').trim()) return false;
    const words = (s.raw_transcript ?? '').split(/\s+/).filter(Boolean).length;
    if (words < MIN_TRANSCRIPT_WORDS) {
      declined.push(s);
      return false;
    }
    return true;
  });
  if (declined.length) {
    console.error(
      `skipping ${declined.length} session(s) the pipeline now declines\n`,
    );
  }
  const subset = limit > 0 ? usable.slice(0, limit) : usable;
  console.error(
    `\nreplaying ${subset.length} sessions through the current pipeline (${model})\n`,
  );

  const out: unknown[] = [];
  let grounded = 0;
  for (const [i, s] of subset.entries()) {
    const extraction = {
      positionsVisited: s.positions_visited ?? [],
      keyMistake: s.key_mistake ?? '',
      opponentAction: s.opponent_action ?? '',
      // Baseline sessions predate the perspective field, so this is the WORST
      // case: everything must be recovered from the transcript.
      perspective: 'unknown' as const,
      rawTranscript: s.raw_transcript ?? '',
    };
    const ids = candidatePositions(extraction);
    const pool = recs
      .filter((r) => ids.includes(r.position))
      .map((r) => ({
        ...r,
        gi: r.preconditions.gi,
        level: r.preconditions.level,
        opponent: r.preconditions.opponent,
      }));
    const top = rankRecords(pool, extraction.keyMistake);
    if (top.length) grounded++;

    const prompt = BJJ_COACHING_PROMPT.replaceAll(
      '{{SKILL_LEVEL}}',
      s.skill_level ?? 'Blue Belt',
    )
      .replaceAll('{{KEY_MISTAKE}}', extraction.keyMistake)
      .replaceAll('{{OPPONENT_ACTION}}', extraction.opponentAction)
      .replaceAll(
        '{{POSITIONS_VISITED}}',
        extraction.positionsVisited.join(', ') || 'none',
      )
      .replaceAll('{{RECENT_MISTAKES}}', 'none recorded')
      .replaceAll('{{DOMINANT_WEAKNESS}}', 'not yet established')
      .replaceAll('{{MAX_WORDS}}', '25')
      .replace('{{GROUNDING}}', groundingSection(top));

    const newCue = await coach(prompt, key, model);
    out.push({
      sessionId: s.id,
      positions: ids,
      recordsInjected: top.length,
      transcript: s.raw_transcript ?? '',
      keyMistake: extraction.keyMistake,
      oldCue: s.coaching_cue,
      newCue,
    });
    process.stderr.write(`\r  ${i + 1}/${subset.length}`);
  }

  const outPath = join(homedir(), 'flowlog-baseline', 'replay.json');
  mkdirSync(join(homedir(), 'flowlog-baseline'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.error(`\n\ngrounded ${grounded}/${subset.length} sessions`);
  console.error(`written  ${outPath}\n`);
}

main().catch((e) => die(String(e?.stack ?? e)));
