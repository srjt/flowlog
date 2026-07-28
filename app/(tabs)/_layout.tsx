import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { isDemoMode, isLocalPipeline } from '@/config/featureFlags';
import { useUserStore } from '@/store/userStore';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Tab icon that swaps to the outline variant when inactive and inherits the tab tint. */
const tabIcon =
  (active: IoniconName, inactive: IoniconName) =>
  ({
    color,
    size,
    focused,
  }: {
    color: string;
    size: number;
    focused: boolean;
  }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );

/**
 * Main app tabs: Record, Log, Trends, Profile. The transient recording-flow
 * screens (Processing, Result) live in the (flow) stack group, NOT here, so the
 * tab bar only shows real destinations.
 *
 * Guards the tab group: if you land here without an authenticated user (e.g. a
 * web refresh that deep-links into a tab), bounce to login. In demo / local-test
 * mode the root layout auto-signs-in a dev user, so this never fires there.
 */
export default function TabsLayout() {
  const authUser = useUserStore((s) => s.authUser);
  if (!authUser && !isDemoMode && !isLocalPipeline) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#16161D', borderTopColor: '#16161D' },
        tabBarActiveTintColor: '#5B8DEF',
        tabBarInactiveTintColor: '#8A8A99',
      }}
    >
      <Tabs.Screen
        name="record"
        options={{ title: 'Record', tabBarIcon: tabIcon('mic', 'mic-outline') }}
      />
      <Tabs.Screen
        name="log"
        options={{ title: 'Log', tabBarIcon: tabIcon('list', 'list-outline') }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: 'Trends',
          tabBarIcon: tabIcon('trending-up', 'trending-up-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: tabIcon('person', 'person-outline'),
        }}
      />
    </Tabs>
  );
}
