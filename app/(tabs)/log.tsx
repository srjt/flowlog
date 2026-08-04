import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CueImage } from '@/components/CueImage';
import { Card, Text } from '@/components/ui';
import { loadSessions } from '@/services/sessionsSource';
import { useSessionStore } from '@/store/sessionStore';
import { useUserStore } from '@/store/userStore';
import type { Session } from '@/types/session';
import { cueImageUrlForKey } from '@/utils/cueImageUrl';
import { groupSessionsByWeek } from '@/utils/groupSessionsByWeek';
import { logger } from '@/utils/logger';

/**
 * Screen 4 — the training journal. Sessions are grouped into week sections
 * (newest first), searchable by cue / mistake / position text, and filterable to
 * "needs review" (👎 or no feedback yet). Loaded from the right source for the
 * current mode and refreshed on focus so new sessions appear.
 */
export default function LogScreen() {
  const history = useSessionStore((s) => s.history);
  const setHistory = useSessionStore((s) => s.setHistory);
  const { authUser, activeSport } = useUserStore();

  const [query, setQuery] = useState('');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const userId = authUser?.id ?? 'demo-user';
      loadSessions(userId, activeSport)
        .then(setHistory)
        .catch((err) => logger.warn('sessions load failed', err));
    }, [authUser, activeSport, setHistory]),
  );

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = history.filter((s) => {
      if (needsReviewOnly && s.thumbsUp === true) return false;
      if (!q) return true;
      return matchesQuery(s, q);
    });
    return groupSessionsByWeek(filtered);
  }, [history, query, needsReviewOnly]);

  const empty = history.length === 0;
  const noMatches = !empty && sections.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-6 py-6">
        <Text variant="title" className="mb-4">
          Log
        </Text>

        {!empty ? (
          <View className="mb-4 gap-3">
            <TextInput
              testID="log-search"
              value={query}
              onChangeText={setQuery}
              placeholder="Search cue, mistake, position…"
              placeholderTextColor="#6B6B76"
              className="rounded-xl border border-muted bg-surface px-4 py-3 text-white"
            />
            <Pressable
              testID="log-filter-needs-review"
              accessibilityRole="button"
              accessibilityLabel="Show only sessions that need review"
              accessibilityState={{ selected: needsReviewOnly }}
              onPress={() => setNeedsReviewOnly((v) => !v)}
              className={`min-h-[44px] justify-center self-start rounded-full border px-4 py-2 ${
                needsReviewOnly
                  ? 'border-primary bg-primary/20'
                  : 'border-muted bg-surface'
              }`}
            >
              <Text variant="caption">Needs review</Text>
            </Pressable>
          </View>
        ) : null}

        {empty ? (
          <Card>
            <Text variant="caption">
              No sessions yet. Your reflections will appear here.
            </Text>
          </Card>
        ) : noMatches ? (
          <Card>
            <Text variant="caption">No sessions match your search.</Text>
          </Card>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text variant="caption" className="mb-2 mt-4 uppercase">
                {section.title}
              </Text>
            )}
            ItemSeparatorComponent={() => <View className="h-3" />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/session/${item.id}`)}
              >
                <Card className="flex-row gap-3">
                  <CueImage
                    url={cueImageUrlForKey(item.cueImageKey)}
                    cue={item.coachingCue ?? ''}
                    variant="thumb"
                  />
                  <View className="flex-1 gap-1">
                    <Text variant="caption" className="text-white">
                      {new Date(item.sessionDate).toLocaleDateString()} ·{' '}
                      {item.sportKey.toUpperCase()}
                      {item.thumbsUp == null ? ' · needs review' : ''}
                    </Text>
                    <Text variant="body">{item.coachingCue ?? '—'}</Text>
                    {item.keyMistake ? (
                      <Text variant="caption">Mistake: {item.keyMistake}</Text>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

/** Case-insensitive match across the searchable text fields of a session. */
function matchesQuery(s: Session, q: string): boolean {
  const haystack = [
    s.coachingCue,
    s.keyMistake,
    s.targetPosition,
    s.opponentAction,
    ...s.positionsVisited,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
