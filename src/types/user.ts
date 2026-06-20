import type { SportKey } from '@/types/sport';

/**
 * Skill level is sport-relative: a belt for BJJ, a handicap tier for golf,
 * an Elo band for chess. Stored as free text in the DB; sport contexts
 * interpret it.
 */
export type SkillLevel = string;

/** Mirrors the `public.profiles` table. */
export interface UserProfile {
  id: string;
  displayName: string | null;
  activeSport: SportKey;
  skillLevel: SkillLevel | null;
  onboardingComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Authenticated session state held in the user store. */
export interface AuthUser {
  id: string;
  email: string | null;
}
