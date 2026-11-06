import { ClaudeProvider } from '@/providers/ai/ClaudeProvider';
import { GeminiProvider } from '@/providers/ai/GeminiProvider';
import { OpenAIProvider } from '@/providers/ai/OpenAIProvider';
import { GeminiTranscriptionProvider } from '@/providers/transcription/GeminiTranscriptionProvider';
import { WhisperProvider } from '@/providers/transcription/WhisperProvider';
import { getSportContext } from '@/sports';
import type { CoachingInput, ExtractionInput } from '@/types/pipeline';
import type { SpecRequest } from '@/visualization/diagramStage';

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
    perspective: 'bottom',
    statedGi: 'unknown',
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

  it('answers "no response" for a spec rather than throwing (#135)', async () => {
    await expect(
      new OpenAIProvider('key').generateDiagramSpec(specRequest),
    ).resolves.toBeNull();
  });
});

// ── Cue -> diagram spec (#135) ───────────────────────────────────────────────
// The contract both real providers keep: the raw answer, or null. Never a
// throw, because the stage is best-effort and must not cost the Session.
const specRequest: SpecRequest = {
  prompt: 'You are a test instructor annotating a mechanical force diagram.',
  schema: { type: 'object' },
  timeoutMs: 1000,
};
const SPEC_TEXT = '{"specVersion":1,"base":"b","annotations":[]}';

/** A fetch that never answers, but rejects when its request is aborted. */
function hangingFetch() {
  global.fetch = jest.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      }),
  ) as unknown as typeof fetch;
}

describe.each([
  [
    'GeminiProvider',
    () => new GeminiProvider('key', 'extraction-model'),
    () => new GeminiProvider(''),
    (text: string) => geminiTextResponse(text),
  ],
  [
    'ClaudeProvider',
    () => new ClaudeProvider('key'),
    () => new ClaudeProvider(''),
    (text: string) => claudeTextResponse(text),
  ],
])('%s.generateDiagramSpec', (_name, make, keyless, wrap) => {
  it('returns the raw model text, unparsed', async () => {
    mockFetchJson(wrap(SPEC_TEXT));
    await expect(make().generateDiagramSpec(specRequest)).resolves.toBe(
      SPEC_TEXT,
    );
  });

  it('sends the prompt as given, with an abort signal', async () => {
    mockFetchJson(wrap(SPEC_TEXT));
    await make().generateDiagramSpec(specRequest);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(init.body).toContain(
      JSON.stringify(specRequest.prompt).slice(1, -1),
    );
  });

  it.each([
    [
      'a network error',
      () =>
        (global.fetch = jest
          .fn()
          .mockRejectedValue(new Error('boom')) as unknown as typeof fetch),
    ],
    [
      'a non-OK status',
      () => mockFetchJson({ error: 'overloaded' }, false, 503),
    ],
    ['an empty answer', () => mockFetchJson({})],
  ])('resolves to null on %s', async (_label, arrange) => {
    arrange();
    await expect(make().generateDiagramSpec(specRequest)).resolves.toBeNull();
  });

  it('resolves to null without a key, and makes no request', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(
      keyless().generateDiagramSpec(specRequest),
    ).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('aborts the request at the deadline and resolves to null', async () => {
    hangingFetch();
    await expect(
      make().generateDiagramSpec({ ...specRequest, timeoutMs: 10 }),
    ).resolves.toBeNull();
  });
});

describe('GeminiProvider.generateDiagramSpec request', () => {
  it('uses the configured model in JSON mode, at temperature 0, with no native schema', async () => {
    mockFetchJson(geminiTextResponse(SPEC_TEXT));
    await new GeminiProvider('key', 'extraction-model').generateDiagramSpec(
      specRequest,
    );
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/extraction-model:generateContent');
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      temperature: 0,
    });
    // Unverified against the live API, and its schema subset rejects
    // `additionalProperties`: the prompt and the validator are the floor.
    expect(body.generationConfig).not.toHaveProperty('responseSchema');
  });

  it('leaves the coaching request exactly as it was', async () => {
    mockFetchJson(
      geminiTextResponse(
        '{"cue":"Trap a wrist first.","targetPosition":"Turtle","confidenceScore":0.8,"isGeneric":false}',
      ),
    );
    await new GeminiProvider('key').generateCoachingCue(coachingInput);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).generationConfig.temperature).toBe(0.4);
    expect(init.signal).toBeUndefined();
  });
});
