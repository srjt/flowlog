import { PIPELINE_CONFIG } from '@/constants/pipelineConfig';
import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import {
  RecordingTooShortError,
  TranscriptionService,
} from '@/services/TranscriptionService';
import { getSportContext } from '@/sports';
import { MockAIProvider, MockTranscriptionProvider } from '../mocks';

const bjj = getSportContext('bjj');

describe('TranscriptionService', () => {
  it('primes the provider with sport vocabulary', async () => {
    const provider = new MockTranscriptionProvider();
    const service = new TranscriptionService(provider);
    await service.transcribe('file://a.m4a', bjj);
    expect(provider.calls[0]?.vocabulary).toBe(bjj.vocabulary);
  });

  it('rejects recordings shorter than the sport minimum', async () => {
    const provider = new MockTranscriptionProvider({
      transcript: 'too short',
      confidence: 0.9,
      detectedTerms: [],
      durationSeconds: 5,
    });
    const service = new TranscriptionService(provider);
    await expect(
      service.transcribe('file://a.m4a', bjj),
    ).rejects.toBeInstanceOf(RecordingTooShortError);
  });

  it('rejects empty transcripts', async () => {
    const provider = new MockTranscriptionProvider({
      transcript: '   ',
      confidence: 0.9,
      detectedTerms: [],
      durationSeconds: 60,
    });
    const service = new TranscriptionService(provider);
    await expect(service.transcribe('file://a.m4a', bjj)).rejects.toThrow(
      /empty/,
    );
  });
});

describe('ExtractionService', () => {
  it('normalises an out-of-vocabulary sentiment to neutral', async () => {
    const ai = new MockAIProvider({
      positionsVisited: ['Mount'],
      keyMistake: 'x',
      opponentAction: 'y',
      sentiment: 'ecstatic-and-invalid',
      rawTranscript: '',
    });
    const service = new ExtractionService(ai);
    const out = await service.extract('transcript', bjj, 'Blue Belt');
    expect(out.sentiment).toBe('neutral');
    expect(out.rawTranscript).toBe('transcript');
  });

  it('passes a valid sentiment through unchanged', async () => {
    const ai = new MockAIProvider({
      positionsVisited: [],
      keyMistake: 'x',
      opponentAction: 'y',
      sentiment: 'frustrated',
      rawTranscript: '',
    });
    const out = await new ExtractionService(ai).extract('t', bjj, 'White Belt');
    expect(out.sentiment).toBe('frustrated');
  });
});

describe('CoachingService word-cap helpers', () => {
  it('counts words correctly', () => {
    expect(CoachingService.countWords('one two three')).toBe(3);
    expect(CoachingService.countWords('   ')).toBe(0);
  });

  it('detects over-cap cues', () => {
    const long = Array.from({ length: 26 }, () => 'w').join(' ');
    expect(CoachingService.exceedsWordCap(long, 25)).toBe(true);
    expect(CoachingService.exceedsWordCap('short cue', 25)).toBe(false);
  });

  it('truncates to the cap for fallback safety', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    expect(
      CoachingService.countWords(CoachingService.truncateToWordCap(long, 25)),
    ).toBe(25);
  });

  it('forwards the strict flag to the provider', async () => {
    const ai = new MockAIProvider();
    const service = new CoachingService(ai);
    await service.generate(
      {
        extraction: ai.extraction,
        sportContext: bjj,
        recentMistakes: [],
        skillLevel: 'Blue Belt',
        dominantWeakness: null,
      },
      true,
    );
    expect(ai.lastStrict).toBe(true);
  });
});

// ── Sufficiency (issue #44) ──────────────────────────────────────────────────
describe('ExtractionService.judgeSufficiency', () => {
  const long =
    'I kept getting stuck under side control and could not frame properly';

  it('accepts a transcript both checks agree on', () => {
    expect(ExtractionService.judgeSufficiency(long, true, '')).toEqual({
      hasCoachableContent: true,
      insufficientReason: '',
    });
  });

  it('declines when the model says there is nothing there', () => {
    const out = ExtractionService.judgeSufficiency(long, false, 'only a plan');
    expect(out.hasCoachableContent).toBe(false);
    expect(out.insufficientReason).toBe('only a plan');
  });

  it('declines on the word floor even when the model says it is fine', () => {
    // The backstop exists precisely because the model verdict can be wrong.
    const out = ExtractionService.judgeSufficiency('Yeah', true, '');
    expect(out.hasCoachableContent).toBe(false);
    expect(out.insufficientReason).toMatch(/too short/i);
  });

  it('prefers the model reason when both checks decline', () => {
    const out = ExtractionService.judgeSufficiency(
      'Yeah ok',
      false,
      'no training described',
    );
    expect(out.insufficientReason).toBe('no training described');
  });

  it('treats a missing model verdict as sufficient — degrades, never over-declines', () => {
    // A provider that has not been updated must not decline every session.
    expect(
      ExtractionService.judgeSufficiency(long, undefined, undefined)
        .hasCoachableContent,
    ).toBe(true);
  });

  it('does not veto a short but concrete reflection', () => {
    const terse = 'Got mounted three times, could not bridge, he was heavy';
    expect(
      ExtractionService.judgeSufficiency(terse, true, '').hasCoachableContent,
    ).toBe(true);
  });

  it('falls back to a mechanical reason when the model gives none', () => {
    const out = ExtractionService.judgeSufficiency(long, false, '   ');
    expect(out.insufficientReason).toBe('no training was described');
  });
});

describe('fallback cue', () => {
  it('does not contain any phrase the quality gate rejects', () => {
    // The fallback bypasses the gate, so it must not say what the gate bans.
    const cue = PIPELINE_CONFIG.fallbackCoachingCue.toLowerCase();
    const hits = bjj.qualityGatePhrases.filter((p) =>
      cue.includes(p.toLowerCase()),
    );
    expect(hits).toEqual([]);
  });

  it('is within the word cap', () => {
    expect(
      CoachingService.exceedsWordCap(PIPELINE_CONFIG.fallbackCoachingCue),
    ).toBe(false);
  });
});

// ── Perspective (issue #48) ─────────────────────────────────────────────────
describe('ExtractionService.normalisePerspective', () => {
  it('accepts the two real sides', () => {
    expect(ExtractionService.normalisePerspective('top')).toBe('top');
    expect(ExtractionService.normalisePerspective('bottom')).toBe('bottom');
  });

  it('turns anything else into unknown rather than trusting it through', () => {
    // A bad value here produces coaching aimed at the wrong side of the
    // position, so the only safe default is to abstain.
    for (const bad of [
      undefined,
      null,
      '',
      'neutral',
      'TOP',
      'on top',
      'both',
      42,
      {},
    ]) {
      expect(ExtractionService.normalisePerspective(bad)).toBe('unknown');
    }
  });
});
