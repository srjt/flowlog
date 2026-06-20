import { create } from 'zustand';

import {
  DEFAULT_DIGEST_PREFS,
  DEFAULT_REMINDER_PREFS,
  type DigestPrefs,
  type ReminderPrefs,
} from '@/types/notifications';
import type { AuthUser, SkillLevel, UserProfile } from '@/types/user';
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
  /** Whether first-run onboarding (sport/skill pick, mic priming) is done. */
  onboardingComplete: boolean;
  /** Local post-training reminder preferences (mirrors persisted prefs). */
  reminderPrefs: ReminderPrefs;
  /** Weekly digest preferences (mirrors persisted prefs). */
  digestPrefs: DigestPrefs;

  setAuthUser: (user: AuthUser | null) => void;
  setProfile: (profile: UserProfile | null) => void;
  setActiveSport: (sport: SportKey) => void;
  setSkillLevel: (level: SkillLevel) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setReminderPrefs: (prefs: ReminderPrefs) => void;
  setDigestPrefs: (prefs: DigestPrefs) => void;
  reset: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  authUser: null,
  profile: null,
  activeSport: 'bjj',
  skillLevel: 'White Belt',
  onboardingComplete: false,
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  digestPrefs: DEFAULT_DIGEST_PREFS,

  setAuthUser: (authUser) => set({ authUser }),
  setProfile: (profile) =>
    set({
      profile,
      activeSport: profile?.activeSport ?? 'bjj',
      skillLevel: profile?.skillLevel ?? 'White Belt',
      onboardingComplete: profile?.onboardingComplete ?? false,
    }),
  setActiveSport: (activeSport) => set({ activeSport }),
  setSkillLevel: (skillLevel) => set({ skillLevel }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setReminderPrefs: (reminderPrefs) => set({ reminderPrefs }),
  setDigestPrefs: (digestPrefs) => set({ digestPrefs }),
  reset: () =>
    set({
      authUser: null,
      profile: null,
      activeSport: 'bjj',
      skillLevel: 'White Belt',
      onboardingComplete: false,
      reminderPrefs: DEFAULT_REMINDER_PREFS,
      digestPrefs: DEFAULT_DIGEST_PREFS,
    }),
}));
