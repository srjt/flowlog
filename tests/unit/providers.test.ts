import { ClaudeProvider } from '@/providers/ai/ClaudeProvider';
import { GeminiProvider } from '@/providers/ai/GeminiProvider';
import { OpenAIProvider } from '@/providers/ai/OpenAIProvider';
import { GeminiTranscriptionProvider } from '@/providers/transcription/GeminiTranscriptionProvider';
import { WhisperProvider } from '@/providers/transcription/WhisperProvider';
import { getSportContext } from '@/sports';
import type { CoachingInput, ExtractionInput } from '@/types/pipeline';

const bjj = getSportContext('bjj');

const extractionInput: ExtractionInput = {
  transcript: 'Rolled hard, got my back taken from turtle.',
  sportContext: bjj,
  beltLevel: 'Blue Belt',
};

const coachingInput: CoachingInput = {
  extraction: {
    positionsVisited: ['Turtle'],
    keyMistake: 'Exposed neck in turtle',
    opponentAction: 'Took the back',
    sentiment: 'flat',
    rawTranscript: 'x',
    hasCoachableContent: true,
    insufficientReason: '',
  },
  sportContext: bjj,
  recentMistakes: [],
  skillLevel: 'Blue Belt',
  dominantWeakness: null,
};

function mockFetchJson(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

function claudeTextResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ClaudeProvider', () => {
  it('reports available when an API key is configured', async () => {
    expect(await new ClaudeProvider('key').isAvailable()).toBe(true);
    expect(await new ClaudeProvider('').isAvailable()).toBe(false);
  });

  it('extracts strict JSON from a well-formed response', async () => {
    mockFetchJson(
      claudeTextResponse(
        JSON.stringify({
          positionsVisited: ['Turtle', 'Back Control'],
          keyMistake: 'Exposed neck',
          opponentAction: 'Took the back',
          sentiment: 'flat',
          rawTranscript: 'ignored',
        }),
      ),
    );
    const out = await new ClaudeProvider('key').extract(extractionInput);
    expect(out.positionsVisited).toContain('Turtle');
    // rawTranscript is always our transcript, not the model echo.
    expect(out.rawTranscript).toBe(extractionInput.transcript);
  });

  it('parses JSON even when wrapped in prose/code fences', async () => {
    mockFetchJson(
      claudeTextResponse(
        'Here you go:\n```json\n{"cue":"Trap a wrist first.","targetPosition":"Turtle","confidenceScore":0.8,"isGeneric":false}\n```',
      ),
    );
    const out = await new ClaudeProvider('key').generateCoachingCue(
      coachingInput,
    );
    expect(out.cue).toBe('Trap a wrist first.');
    expect(out.confidenceScore).toBe(0.8);
  });

  it('throws on a network error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    await expect(
      new ClaudeProvider('key').extract(extractionInput),
    ).rejects.toThrow(/network error/);
  });

  it('throws on a non-OK HTTP status', async () => {
    mockFetchJson({ error: 'rate limited' }, false, 429);
    await expect(
      new ClaudeProvider('key').extract(extractionInput),
    ).rejects.toThrow(/429/);
  });

  it('throws on malformed (non-JSON) content', async () => {
    mockFetchJson(claudeTextResponse('totally not json'));
    await expect(
      new ClaudeProvider('key').extract(extractionInput),
    ).rejects.toThrow(/malformed JSON/);
  });
});

describe('GeminiTranscriptionProvider', () => {
  // Override loadAudio so the test doesn't need the Web Audio API.
  class TestGeminiTx extends GeminiTranscriptionProvider {
    protected override async loadAudio() {
      return { base64: 'AAAA', mimeType: 'audio/wav' };
    }
  }

  it('is available only with an API key', async () => {
    expect(await new GeminiTranscriptionProvider('key').isAvailable()).toBe(
      true,
    );
    expect(await new GeminiTranscriptionProvider('').isAvailable()).toBe(false);
  });

  it('transcribes audio and detects primed terms', async () => {
    mockFetchJson(
      geminiTextResponse('I worked from Turtle and then got swept.'),
    );
    const out = await new TestGeminiTx('key').transcribe('blob://x', [
      'Turtle',
    ]);
    expect(out.transcript).toMatch(/Turtle/);
    expect(out.detectedTerms).toContain('Turtle');
  });

  it('throws on a non-OK status', async () => {
    mockFetchJson({ error: 'bad' }, false, 400);
    await expect(
      new TestGeminiTx('key').transcribe('blob://x'),
    ).rejects.toThrow(/400/);
  });

  it('throws on an empty transcript', async () => {
    mockFetchJson(geminiTextResponse('   '));
    await expect(
      new TestGeminiTx('key').transcribe('blob://x'),
    ).rejects.toThrow(/empty transcript/);
  });
});

describe('WhisperProvider', () => {
  it('is unavailable without an API key', async () => {
    expect(await new WhisperProvider('').isAvailable()).toBe(false);
  });

  it('transcribes a well-formed verbose response and detects primed terms', async () => {
    mockFetchJson({
      text: 'I worked from Turtle and got swept.',
      duration: 62,
      segments: [{ avg_logprob: -0.2 }],
    });
    const out = await new WhisperProvider('key').transcribe('file://a.m4a', [
      'Turtle',
    ]);
    expect(out.transcript).toMatch(/Turtle/);
    expect(out.detectedTerms).toContain('Turtle');
    expect(out.durationSeconds).toBe(62);
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  it('throws on a non-OK HTTP status', async () => {
    mockFetchJson({ error: 'bad' }, false, 500);
    await expect(
      new WhisperProvider('key').transcribe('file://a.m4a'),
    ).rejects.toThrow(/500/);
  });
});

function geminiTextResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe('GeminiProvider', () => {
  it('is available only with an API key', async () => {
    expect(await new GeminiProvider('key').isAvailable()).toBe(true);
    expect(await new GeminiProvider('').isAvailable()).toBe(false);
  });

  it('extracts strict JSON from a generateContent response', async () => {
    mockFetchJson(
      geminiTextResponse(
        JSON.stringify({
          positionsVisited: ['Turtle'],
          keyMistake: 'Exposed neck',
          opponentAction: 'Took the back',
          sentiment: 'flat',
          rawTranscript: 'ignored',
        }),
      ),
    );
    const out = await new GeminiProvider('key', 'gemini-2.5-flash').extract(
      extractionInput,
    );
    expect(out.positionsVisited).toContain('Turtle');
    expect(out.rawTranscript).toBe(extractionInput.transcript);
  });

  it('parses a coaching cue (fenced JSON tolerated)', async () => {
    mockFetchJson(
      geminiTextResponse(
        '```json\n{"cue":"Trap a wrist first.","targetPosition":"Turtle","confidenceScore":0.8,"isGeneric":false}\n```',
      ),
    );
    const out = await new GeminiProvider('key').generateCoachingCue(
      coachingInput,
    );
    expect(out.cue).toBe('Trap a wrist first.');
    expect(out.confidenceScore).toBe(0.8);
  });

  it('throws on a network error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    await expect(
      new GeminiProvider('key').extract(extractionInput),
    ).rejects.toThrow(/network error/);
  });

  it('throws on a non-OK status', async () => {
    mockFetchJson({ error: 'bad model' }, false, 404);
    await expect(
      new GeminiProvider('key').extract(extractionInput),
    ).rejects.toThrow(/404/);
  });

  it('throws on malformed content', async () => {
    mockFetchJson(geminiTextResponse('not json at all'));
    await expect(
      new GeminiProvider('key').extract(extractionInput),
    ).rejects.toThrow(/malformed JSON/);
  });
});

describe('OpenAIProvider (stub)', () => {
  it('throws clear not-implemented errors', async () => {
    const p = new OpenAIProvider('key');
    await expect(p.extract(extractionInput)).rejects.toThrow(/not implemented/);
    await expect(p.generateCoachingCue(coachingInput)).rejects.toThrow(
      /not implemented/,
    );
  });
});
