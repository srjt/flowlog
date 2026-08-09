// #18 harness — the SPEC STAGE. The real post-quality-gate LLM call the
// production pipeline would make: (cue + the target position's role list + the
// grammar) -> a validated, minimal Spec JSON. This is a Gemini TEXT model with
// structured output (responseSchema), NOT an image model — the diagram is drawn
// deterministically downstream.
//
// Mirrors the HTTP shape of src/providers/ai/GeminiProvider.ts (generateContent,
// key as query param, responseMimeType: application/json). Secrets are NOT in
// .env — export GEMINI_API_KEY in the shell (the real pipeline runs it
// server-side). See CLAUDE.md "Pipeline Runtime".

import {
  type Spec,
  SPEC_VERSION,
  MAX_ANNOTATIONS,
  PRIMITIVE_NAMES,
  describeGrammar,
} from './grammar.ts';
import { type Position } from './keypoints.ts';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const SPEC_PROMPT_VERSION = '0.1.0';

export function buildSpecPrompt(pos: Position, cue: string): string {
  const roles = Object.keys(pos.roles).join(', ');
  return `You are a Brazilian Jiu-Jitsu black belt annotating a mechanical force diagram.

You are given ONE coaching cue and a fixed base position. Your job is to output a small, structured spec of mechanical annotations that a renderer will draw as arrows/zones over a stick-figure of the position. You do NOT describe the position itself (the figures are already drawn) — you annotate only the ONE mechanic the cue is about.

BASE POSITION: "${pos.label}" (id: "${pos.id}")

AVAILABLE SEMANTIC ROLES (you may ONLY reference these — they are the named anchor points on this position):
${roles}

ANNOTATION GRAMMAR (the only primitive types allowed):
${describeGrammar()}

RULES:
- Direction is ALWAYS role-relative: use relation { "toward" | "away_from" | "around": <role> }. NEVER raw angles or coordinates.
- Only reference roles from the AVAILABLE list above. If the cue needs a point that isn't listed, pick the closest listed role — never invent one.
- Emit only the mechanic(s) the cue actually describes. Order annotations by importance. Soft cap: ${MAX_ANNOTATIONS}. Fewer is better — 1 to 3 is typical.
- "anchor" is a single role for every primitive EXCEPT "grip", which takes exactly two roles [gripping_hand, gripped_target].
- Do not restate the base position. Do not add annotations the cue doesn't mention.

CUE: "${cue}"

Output ONLY the spec JSON: { "specVersion": ${SPEC_VERSION}, "base": "${pos.id}", "annotations": [ ... ] }.`;
}

// responseSchema handed to Gemini to constrain structured output. Roles/arity
// are still validated in code (the schema can't express "known role").
function responseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      specVersion: { type: 'INTEGER' },
      base: { type: 'STRING' },
      annotations: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: PRIMITIVE_NAMES },
            anchor: {
              anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'STRING' } }],
            },
            relation: {
              type: 'OBJECT',
              properties: {
                toward: { type: 'STRING' },
                away_from: { type: 'STRING' },
                around: { type: 'STRING' },
              },
            },
            intensity: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          },
          required: ['type', 'anchor'],
        },
      },
    },
    required: ['specVersion', 'base', 'annotations'],
  };
}

function parseJson(text: string): Spec {
  const fenced = text.replace(/```json|```/g, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start)
    throw new Error(`malformed JSON: ${text.slice(0, 160)}`);
  return JSON.parse(fenced.slice(start, end + 1)) as Spec;
}

export interface SpecResult {
  spec: Spec;
  source: 'llm' | 'offline';
  model?: string;
}

async function callGemini(
  pos: Position,
  cue: string,
  opts: { apiKey: string; model: string },
): Promise<Spec> {
  const url = `${GEMINI_BASE}/${opts.model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildSpecPrompt(pos, cue) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema(),
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }),
  });
  if (!res.ok)
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
  };
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.[0]?.text;
  if (!text)
    throw new Error(`Gemini returned no text (finishReason=${cand?.finishReason ?? 'unknown'})`);
  const spec = parseJson(text); // throws on malformed JSON — retried by caller
  spec.specVersion = spec.specVersion ?? SPEC_VERSION;
  spec.base = spec.base ?? pos.id;
  return spec;
}

/**
 * Real LLM call: cue + roles + grammar -> Spec. Retries on malformed JSON —
 * even with responseSchema, a text model occasionally emits invalid JSON
 * (truncation / a dropped comma). A retry at temperature is the cheap fix, the
 * same shape as the production pipeline's strict-retry (see GeminiProvider).
 */
export async function requestSpec(
  pos: Position,
  cue: string,
  opts: { apiKey: string; model: string; attempts?: number },
): Promise<SpecResult> {
  const attempts = opts.attempts ?? 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const spec = await callGemini(pos, cue, opts);
      return { spec, source: 'llm', model: opts.model };
    } catch (e) {
      lastErr = e;
      // Non-retryable: HTTP/auth failures won't self-heal.
      if (/Gemini \d{3}:/.test((e as Error).message)) break;
    }
  }
  throw new Error(
    `${(lastErr as Error)?.message ?? lastErr} (after ${attempts} attempt(s))`,
  );
}

/** Offline path: use the hand-authored golden spec (no API key needed). */
export function offlineSpec(
  refSpecs: Record<string, Record<string, Spec['annotations']>>,
  pos: Position,
  cueId: string,
): SpecResult | null {
  const anns = refSpecs[pos.id]?.[cueId];
  if (!anns) return null;
  return {
    spec: { specVersion: SPEC_VERSION, base: pos.id, annotations: anns },
    source: 'offline',
  };
}
