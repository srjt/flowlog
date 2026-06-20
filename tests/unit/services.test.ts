import { CoachingService } from '@/services/CoachingService';
import { ExtractionService } from '@/services/ExtractionService';
import {
  RecordingTooShortError,
  TranscriptionService,
} from '@/services/TranscriptionService';
import { getSportContext } from '@/sports';
import {
  MockAIProvider,
  MockTranscriptionProvider,
} from '../mocks';

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
    await expect(service.transcribe('file://a.m4a', bjj)).rejects.toBeInstanceOf(
      RecordingTooShortError,
    );
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
    expect(CoachingService.countWords(CoachingService.truncateToWordCap(long, 25))).toBe(
      25,
    );
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
