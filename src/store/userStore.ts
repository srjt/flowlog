import { create } from 'zustand';

import {
  DEFAULT_DIGEST_PREFS,
  DEFAULT_REMINDER_PREFS,
  type DigestPrefs,
  type ReminderPrefs,
} from '@/types/notifications';
import type {
  AuthUser,
  GiPreference,
  SkillLevel,
  UserProfile,
} from '@/types/user';
import type { SportKey } from '@/types/sport';

/**
 * User/auth client state. Holds only state — no async API calls live here
 * (that's the providers' job). Actions accept already-fetched data and update
 * the store.
 */
interface UserState {
  authUser: AuthUser | null;
  profile: UserProfile | null;
  activeSport: SportKey;
  skillLevel: SkillLevel;
  /** Default attire, from the profile. The recorder can override per session. */
  giDefault: GiPreference;
  /** Whether first-run onboarding (sport/skill pick, mic priming) is done. */
  onboardingComplete: boolean;
  /**
   * Whether the initial auth restore (session lookup, profile fetch) has
   * completed at least once. Index gates its redirect on this so it doesn't
   * route to /login before an async session restore has had a chance to
   * populate authUser -- without it, a returning logged-in user would flash
   * the login screen and get stuck there, since nothing re-routes a user
   * already past Index.
   */
  authBootstrapped: boolean;
  /** Local post-training reminder preferences (mirrors persisted prefs). */
  reminderPrefs: ReminderPrefs;
  /** Weekly digest preferences (mirrors persisted prefs). */
  digestPrefs: DigestPrefs;

  setAuthUser: (user: AuthUser | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setActiveSport: (sport: SportKey) => void;
  setSkillLevel: (level: SkillLevel) => void;
  setGiDefault: (gi: GiPreference) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setAuthBootstrapped: (done: boolean) => void;
  setReminderPrefs: (prefs: ReminderPrefs) => void;
  setDigestPrefs: (prefs: DigestPrefs) => void;
  reset: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  authUser: null,
  profile: null,
  activeSport: 'bjj',
  skillLevel: 'White Belt',
  giDefault: 'gi',
  onboardingComplete: false,
  authBootstrapped: false,
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  digestPrefs: DEFAULT_DIGEST_PREFS,

  setAuthUser: (authUser) => set({ authUser }),
  setProfile: (profile) =>
    set({
      profile,
      activeSport: profile?.activeSport ?? 'bjj',
      skillLevel: profile?.skillLevel ?? 'White Belt',
      giDefault: profile?.giDefault ?? 'gi',
      onboardingComplete: profile?.onboardingComplete ?? false,
    }),
  setActiveSport: (activeSport) => set({ activeSport }),
  setSkillLevel: (skillLevel) => set({ skillLevel }),
  setGiDefault: (giDefault) => set({ giDefault }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setAuthBootstrapped: (authBootstrapped) => set({ authBootstrapped }),
  setReminderPrefs: (reminderPrefs) => set({ reminderPrefs }),
  setDigestPrefs: (digestPrefs) => set({ digestPrefs }),
  reset: () =>
    set({
      authUser: null,
      profile: null,
      activeSport: 'bjj',
      skillLevel: 'White Belt',
      giDefault: 'gi',
      onboardingComplete: false,
      reminderPrefs: DEFAULT_REMINDER_PREFS,
      digestPrefs: DEFAULT_DIGEST_PREFS,
    }),
}));
