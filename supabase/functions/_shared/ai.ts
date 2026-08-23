// Server-side AI calls — provider-dispatched.
//
// Transcription: Whisper (OpenAI) OR Gemini, chosen by env TRANSCRIPTION_PROVIDER.
// Analysis (extract/coach): Claude OR Gemini, chosen by env AI_PROVIDER.
// All secrets come from the function environment (Deno.env) and never reach the
// client. Mirrors the client providers in `src/providers/`.

import type { ServerSportContext } from './sports.ts';
import type {
  CoachingOutput,
  ExtractionOutput,
  TranscriptionResult,
} from './types.ts';

const OPENAI_TRANSCRIPTION_URL =
  'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const STRICT_RETRY_SUFFIX = `

RETRY — the previous cue was rejected for being too long, too generic, or too low-confidence. Rewrite it UNDER the word limit, hyper-specific to one mechanical detail, and directly tied to the key mistake. Do not output generic motivational advice.`;

function envOr(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}
function requireSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing function secret: ${name}`);
  return value;
}
function transcriptionProvider(): string {
  return envOr('TRANSCRIPTION_PROVIDER', 'whisper');
}
function aiProvider(): string {
  return envOr('AI_PROVIDER', 'claude');
}
function geminiModel(): string {
  return envOr('GEMINI_MODEL', 'gemini-2.5-flash');
}
function geminiTranscriptionModel(): string {
  // Transcription accuracy gates everything downstream (extraction and the
  // coaching cue), so it can run a stronger model than the text stages
  // without touching their cost. Falls back to the shared model.
  return envOr('GEMINI_TRANSCRIPTION_MODEL', geminiModel());
}

/**
 * Gemini's audio API accepts wav/mp3/aiff/aac/ogg/flac. Native recordings
 * upload as `audio/m4a` (AAC in an MPEG-4 container), which is NOT on that
 * list — normalize container mimes to the codec mime Gemini understands.
 */
function geminiAudioMime(blobType: string): string {
  const type = (blobType || '').toLowerCase();
  if (
    type === 'audio/m4a' ||
    type === 'audio/x-m4a' ||
    type === 'audio/mp4'
  ) {
    return 'audio/aac';
  }
  return type || 'audio/aac';
}

// ── Transcription ───────────────────────────────────────────────────────────
export async function transcribe(
  audio: Blob,
  vocabulary: string[],
): Promise<TranscriptionResult> {
  if (transcriptionProvider() === 'gemini') {
    return geminiTranscribe(audio, vocabulary);
  }
  return whisperTranscribe(audio, vocabulary);
}

/**
 * OpenAI infers the audio container from the upload's FILENAME extension, so
 * it must match the actual bytes — native recordings are m4a, web uploads are
 * 16 kHz WAV. A mismatched name (e.g. `.wav` on AAC bytes) makes the decoder
 * misparse the file.
 */
function whisperFilename(blobType: string): string {
  const type = (blobType || '').toLowerCase();
  if (type.includes('wav')) return 'session.wav';
  if (type.includes('mp3') || type.includes('mpeg')) return 'session.mp3';
  if (type.includes('ogg')) return 'session.ogg';
  if (type.includes('flac')) return 'session.flac';
  if (type.includes('webm')) return 'session.webm';
  return 'session.m4a'; // m4a/mp4/aac and the native-recording default
}

async function whisperTranscribe(
  audio: Blob,
  vocabulary: string[],
): Promise<TranscriptionResult> {
  const apiKey = requireSecret('OPENAI_API_KEY');
  const form = new FormData();
  form.append('file', audio, whisperFilename(audio.type));
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'verbose_json');
  if (vocabulary.length > 0) {
    form.append(
      'prompt',
      `This is a sports training reflection. Relevant terminology: ${vocabulary
        .slice(0, 120)
        .join(', ')}.`,
    );
  }
  const res = await fetch(OPENAI_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await safeText(res);
    console.error('whisper transcription failed:', res.status, detail.slice(0, 500));
    throw new Error(`Whisper failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  const transcript = (data.text ?? '').trim();
  return {
    transcript,
    confidence: 0.85,
    detectedTerms: detect(transcript, vocabulary),
    durationSeconds: data.duration ?? 0,
  };
}

async function geminiTranscribe(
  audio: Blob,
  vocabulary: string[],
): Promise<TranscriptionResult> {
  const base64 = await blobToBase64(audio);
  const mimeType = geminiAudioMime(audio.type);
  const prompt =
    'Transcribe the speech in this audio. It is a short post-training voice ' +
    'reflection recorded by an athlete on a phone, possibly with gym ' +
    'background noise. Reference spellings for sport terms the speaker ' +
    `might use: ${vocabulary.slice(0, 120).join(', ')}. ` +
    'Use those spellings ONLY where the speaker clearly says that term — ' +
    'never insert, substitute, or guess a sport term that was not distinctly ' +
    'spoken. Where the audio is unclear, transcribe the closest ordinary ' +
    'words you hear instead of guessing a sport term. Transcribe in the ' +
    'original spoken language; do not translate, summarize, or correct the ' +
    'speaker. Omit filler sounds ("um", "uh"). Return ONLY the transcript ' +
    'text — no labels, no timestamps, no commentary.';
  const text = await geminiGenerate(
    [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    4096,
    false,
    // Verbatim transcription wants determinism, not creativity — and it runs
    // on the (potentially stronger) transcription model.
    { model: geminiTranscriptionModel(), temperature: 0 },
  );
  const transcript = text.trim();
  return {
    transcript,
    confidence: 0.9,
    detectedTerms: detect(transcript, vocabulary),
    durationSeconds: 0,
  };
}

// ── Extraction (Stage 1) ────────────────────────────────────────────────────
export async function extract(
  transcript: string,
  sport: ServerSportContext,
  skillLevel: string,
): Promise<ExtractionOutput> {
  const prompt = fillTemplate(sport.extractionPrompt, {
    TRANSCRIPT: transcript,
    BELT_LEVEL: skillLevel,
    SKILL_LEVEL: skillLevel,
    SENTIMENT_LABELS: sport.sentimentLabels.join(', '),
  });
  const text =
    aiProvider() === 'gemini'
      ? await geminiGenerate([{ text: prompt }], 8192, true)
      : await claude(prompt, 1024);
  const parsed = parseJson(text);
  const sentiment = sport.sentimentLabels.includes(parsed.sentiment)
    ? parsed.sentiment
    : 'neutral';
  return {
    positionsVisited: Array.isArray(parsed.positionsVisited)
      ? parsed.positionsVisited
      : [],
    keyMistake: parsed.keyMistake ?? '',
    opponentAction: parsed.opponentAction ?? '',
    sentiment,
    rawTranscript: transcript,
    // Constrain to accepted values — anything else becomes 'unknown', which
    // makes the position resolve to no id and grounding abstain (issue #48).
    perspective:
      parsed.perspective === 'top' || parsed.perspective === 'bottom'
        ? parsed.perspective
        : 'unknown',
    ...judgeSufficiency(
      transcript,
      parsed.hasCoachableContent,
      parsed.insufficientReason,
    ),
  };
}

/**
 * Sufficiency (issue #44) — mirrors `ExtractionService.judgeSufficiency` on the
 * client. Two independent checks, both must pass before a cue is generated:
 * the model's own verdict, and a word-count backstop that cannot be talked out
 * of its answer. A missing model verdict degrades to `true` (prior behaviour);
 * the backstop still applies.
 */
export const MIN_TRANSCRIPT_WORDS = 8;

export function judgeSufficiency(
  transcript: string,
  modelVerdict: boolean | undefined,
  modelReason: string | undefined,
  minWords: number = MIN_TRANSCRIPT_WORDS,
): { hasCoachableContent: boolean; insufficientReason: string } {
  const trimmed = transcript.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;

  if (words < minWords) {
    return {
      hasCoachableContent: false,
      insufficientReason:
        modelVerdict === false && modelReason?.trim()
          ? modelReason.trim()
          : 'the recording was too short to work from',
    };
  }
  if (modelVerdict === false) {
    return {
      hasCoachableContent: false,
      insufficientReason: modelReason?.trim() || 'no training was described',
    };
  }
  return { hasCoachableContent: true, insufficientReason: '' };
}

// ── Coaching (Stage 2) ──────────────────────────────────────────────────────
export async function generateCoaching(
  extraction: ExtractionOutput,
  sport: ServerSportContext,
  recentMistakes: string[],
  skillLevel: string,
  dominantWeakness: string | null,
  maxWords: number,
  strict: boolean,
): Promise<CoachingOutput> {
  const base = fillTemplate(sport.coachingPrompt, {
    SKILL_LEVEL: skillLevel,
    KEY_MISTAKE: extraction.keyMistake,
    OPPONENT_ACTION: extraction.opponentAction,
    POSITIONS_VISITED: extraction.positionsVisited.join(', ') || 'none',
    RECENT_MISTAKES: recentMistakes.join('; ') || 'none recorded',
    DOMINANT_WEAKNESS: dominantWeakness ?? 'not yet established',
    MAX_WORDS: String(maxWords),
  });
  const prompt = base + (strict ? STRICT_RETRY_SUFFIX : '');
  const text =
    aiProvider() === 'gemini'
      ? await geminiGenerate([{ text: prompt }], 4096, true)
      : await claude(prompt, 512);
  const parsed = parseJson(text);
  return {
    cue: (parsed.cue ?? '').trim(),
    targetPosition: parsed.targetPosition ?? '',
    confidenceScore:
      typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0,
    isGeneric: parsed.isGeneric === true,
  };
}

// ── Claude ──────────────────────────────────────────────────────────────────
async function claude(prompt: string, maxTokens: number): Promise<string> {
  const apiKey = requireSecret('ANTHROPIC_API_KEY');
  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    console.error('claude call failed:', res.status, detail.slice(0, 500));
    throw new Error(`Claude failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  const block = (data.content ?? []).find(
    (b: { type: string; text?: string }) => b.type === 'text',
  );
  if (!block?.text) throw new Error('Claude returned no text content.');
  return block.text;
}

// ── Gemini ──────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function geminiGenerate(
  parts: any[],
  maxOutputTokens: number,
  jsonMode: boolean,
  opts: { model?: string; temperature?: number } = {},
): Promise<string> {
  const apiKey = requireSecret('GEMINI_API_KEY');
  const url = `${GEMINI_BASE}/${opts.model ?? geminiModel()}:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`;
  // deno-lint-ignore no-explicit-any
  const generationConfig: any = {
    maxOutputTokens,
    temperature: opts.temperature ?? 0.4,
  };
  if (jsonMode) generationConfig.responseMimeType = 'application/json';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    console.error('gemini call failed:', res.status, detail.slice(0, 500));
    throw new Error(`Gemini failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text content.');
  return text;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
    template,
  );
}

// deno-lint-ignore no-explicit-any
function parseJson(text: string): any {
  const fenced = text.replace(/```json|```/g, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`AI returned malformed JSON: ${text.slice(0, 200)}`);
  }
  return JSON.parse(fenced.slice(start, end + 1));
}

function detect(transcript: string, vocabulary: string[]): string[] {
  const hay = transcript.toLowerCase();
  return vocabulary.filter((t) => hay.includes(t.toLowerCase()));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
