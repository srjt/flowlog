import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { syncDigestHistory, type WeeklyDigest } from '@/services/DigestService';
import { loadSessions } from '@/services/sessionsSource';
import { useUserStore } from '@/store/userStore';
import { logger } from '@/utils/logger';

interface DigestHistoryState {
  history: WeeklyDigest[];
  loading: boolean;
}

/**
 * Loads the active sport's sessions, materializes any newly-elapsed weekly
 * digests into the locally-persisted history, and returns it newest-first.
 * Runs on screen focus so opening any digest surface catches up weeks the user
 * was away for. Failures fall back to an empty history rather than crashing —
 * the review UI stays usable (and web, where notifications no-op, still renders
 * from whatever is stored).
 */
export function useDigestHistory(): DigestHistoryState {
  const { authUser, activeSport } = useUserStore();
  const [state, setState] = useState<DigestHistoryState>({
    history: [],
    loading: true,
  });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setState((s) => ({ ...s, loading: true }));
      (async () => {
        try {
          const sessions = await loadSessions(
            authUser?.id ?? 'demo-user',
            activeSport,
          );
          const scoped = sessions.filter((s) => s.sportKey === activeSport);
          const history = await syncDigestHistory(scoped);
          if (active) setState({ history, loading: false });
        } catch (err) {
          logger.warn('digest history load failed', err);
          if (active) setState({ history: [], loading: false });
        }
      })();
      return () => {
        active = false;
      };
    }, [authUser, activeSport]),
  );

  return state;
}
