import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from '@/utils/logger';

/**
 * One-time flag for the first-run feature tour. Local-only and deliberately not
 * a profile column: an unset flag is what lets existing testers see the tour
 * once on their next launch, and replaying it after a full reinstall is fine.
 *
 * A storage failure degrades to "not seen" rather than throwing — showing the
 * tour an extra time is a far cheaper failure than blocking the entry gate.
 */
const KEY = 'flowlog.featureTourSeen.v1';

export async function hasSeenFeatureTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch (err) {
    logger.warn('hasSeenFeatureTour failed', err);
    return false;
  }
}

export async function markFeatureTourSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch (err) {
    logger.warn('markFeatureTourSeen failed', err);
  }
}
