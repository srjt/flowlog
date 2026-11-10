/**
 * Everything the cue judge touches outside itself: the `.env` file, the two
 * model APIs and the serving store. Shared by `run.ts` (validation against the
 * frozen verdicts) and `opine.ts` (second opinions on live Cues), so the
 * instrument being validated and the instrument being used are the same one.
 *
 * Errors are thrown, never swallowed: a failed model call must stop the run,
 * not turn into a verdict.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Complete } from './judge.ts';
import type { GroundableRecord } from '../../src/sports/grounding.ts';

/**
 * A different model from the one that WROTE the original cues
 * (`gemini-2.5-flash`). Not a circularity fix: cross-family buys little
 * independence, so the harness prints the family rather than hiding it.
 */
export const DEFAULT_JUDGE_MODEL = 'gemini-3.1-pro-preview';

export const judgeModel = (): string =>
  process.env.JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;

export const familyOf = (model: string): 'claude' | 'gemini' =>
  model.startsWith('claude') ? 'claude' : 'gemini';

/** Reads `.env` from the working directory without overriding the shell. */
export function loadEnv(): void {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

function needKey(name: string): string {
  const key = process.env[name];
  if (!key)
    throw new Error(`${name} is not set. Add it to .env or the environment.`);
  return key;
}

function callClaude(model: string): Complete {
  return async (prompt) => {
    const key = needKey('ANTHROPIC_API_KEY');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        // Judging, not writing. Deterministic so a re-run of the same cue
        // cannot produce a different verdict and quietly move the score.
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`,
      );
    }
    const json = (await res.json()) as {
      content: { type: string; text?: string }[];
    };
    return (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  };
}

function callGemini(model: string): Complete {
  return async (prompt) => {
    const key = needKey('GEMINI_API_KEY');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/` +
        `${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            // Judging, not writing. Near-deterministic so a re-run of the same
            // cue does not produce a different verdict and move the score.
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Gemini API ${res.status}: ${(await res.text()).slice(0, 400)}`,
      );
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
  };
}

/** The model call for `model`, by its family. */
export const modelCall = (model: string): Complete =>
  familyOf(model) === 'claude' ? callClaude(model) : callGemini(model);

/** The serving store's URL and service-role key, or null when either is missing. */
export function supabaseAdmin(): { url: string; key: string } | null {
  const url =
    process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

/**
 * Records for a position, straight from the serving store. Throws when the
 * store can't be read: an unreadable store must not pass for "no records",
 * which would quietly turn a grounded check into an ungrounded one.
 */
export async function fetchRecords(
  positionId: string | null,
): Promise<GroundableRecord[]> {
  if (!positionId) return [];
  const db = supabaseAdmin();
  if (!db) {
    throw new Error(
      'SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
  }
  const res = await fetch(
    `${db.url}/rest/v1/coaching_records?select=*&sport_key=eq.bjj` +
      `&position=eq.${encodeURIComponent(positionId)}&limit=200`,
    { headers: { apikey: db.key, Authorization: `Bearer ${db.key}` } },
  );
  if (!res.ok) {
    throw new Error(
      `coaching_records ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as GroundableRecord[];
}

/**
 * The validation run's original behaviour: no records when the store can't be
 * read. Kept so `run.ts` measures exactly what it always measured.
 */
export async function loadRecords(
  positionId: string | null,
): Promise<GroundableRecord[]> {
  try {
    return await fetchRecords(positionId);
  } catch {
    return [];
  }
}
