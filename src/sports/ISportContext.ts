import type { SportKey } from '@/types/sport';

/**
 * The contract every sport implements. The pipeline is sport-agnostic: it
 * receives a `sportKey`, fetches the matching context from the registry, and
 * threads it through every stage. No pipeline, service, or provider code ever
 * contains sport-specific branching.
 *
 * Adding a sport = implementing this interface + registering it. Nothing else.
 */
export interface ISportContext {
  /** Stable identifier, e.g. 'bjj' | 'golf' | 'tennis' | 'climbing' | 'chess'. */
  sportKey: SportKey;

  /** Human-readable name, e.g. 'Brazilian Jiu-Jitsu'. */
  displayName: string;

  /** Domain terms used to prime the transcription provider (Whisper). */
  vocabulary: string[];

  /** What one unit of practice is called: 'roll' | 'round' | 'session' | 'game'. */
  sessionUnit: string;

  /** Stage 1 prompt — structured extraction. Must NOT generate coaching. */
  extractionPrompt: string;

  /** Stage 2 prompt — coaching cue generation. Caps response at 25 words. */
  coachingPrompt: string;

  /** Sport-appropriate sentiment labels the extraction may choose from. */
  sentimentLabels: string[];

  /** Skill-level options for this sport (belts for BJJ, tiers for golf, …). */
  skillLevels: string[];

  /** Generic phrases the quality gate rejects for this sport. */
  qualityGatePhrases: string[];

  /** Recording bounds for this sport (seconds). */
  minRecordingSeconds: number;
  maxRecordingSeconds: number;
}
