import type { SportKey } from '@/types/sport';

/**
 * Skill level is sport-relative: a belt for BJJ, a handicap tier for golf,
 * an Elo band for chess. Stored as free text in the DB; sport contexts
 * interpret it.
 */
export type SkillLevel = string;

/**
 * Whether training happens in the gi or without it.
 *
 * Load-bearing for grounding: a mechanic that depends on a lapel or sleeve
 * grip is not merely less useful without a jacket, it is impossible.
 */
export type GiPreference = 'gi' | 'no-gi';

/** Mirrors the `public.profiles` table. */
export interface UserProfile {
  id: string;
  displayName: string | null;
  activeSport: SportKey;
  skillLevel: SkillLevel | null;
  /** Default attire, asked once at onboarding. Existing users backfilled to 'gi'. */
  giDefault: GiPreference | null;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Authenticated session state held in the user store. */
export interface AuthUser {
  id: string;
  email: string | null;
}
