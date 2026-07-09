import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { logThrown, serializeThrown } from '@/utils/errorReporter';

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
  componentStack: string | null;
}

/**
 * Last-resort boundary above the navigator. Its main job is catching route
 * modules that throw during expo-router's lazy require (React.lazy surfaces
 * those during render, and expo-router doesn't wrap the require in
 * try/catch) — previously a hard crash reported only as
 * "Unhandled JS Exception: [object Object]". See docs/SDK54_UPGRADE.md.
 *
 * Deliberately renders with plain React Native primitives and inline styles:
 * no nativewind, no reanimated, no safe-area hooks — nothing that could
 * itself be the thing that just failed.
 */
export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logThrown('[flowlog] ROOT ERROR BOUNDARY', error);
    if (info.componentStack) {
      logThrown(
        '[flowlog] ROOT ERROR BOUNDARY componentStack',
        info.componentStack,
      );
      this.setState({ componentStack: info.componentStack });
    }
  }

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0B0F', paddingTop: 80 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 22,
              fontWeight: '700',
              marginBottom: 12,
            }}
          >
            Something crashed
          </Text>
          <Text style={{ color: '#8A8A99', fontSize: 14, marginBottom: 16 }}>
            Screenshot this screen and share it — it contains the real error.
          </Text>
          <Text
            selectable
            style={{ color: '#FF6B6B', fontSize: 12, marginBottom: 16 }}
          >
            {serializeThrown(this.state.error)}
          </Text>
          {this.state.componentStack ? (
            <Text selectable style={{ color: '#8A8A99', fontSize: 11 }}>
              {this.state.componentStack}
            </Text>
          ) : null}
          <Pressable
            onPress={() => this.setState({ error: null, componentStack: null })}
            style={{
              marginTop: 24,
              alignSelf: 'flex-start',
              backgroundColor: '#5B8DEF',
              borderRadius: 8,
              paddingHorizontal: 20,
              paddingVertical: 12,
            }}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
              Try again
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}
