import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type ScrollTarget = {
  scrollTo?: (opts: { y: number; animated?: boolean }) => void;
  scrollToEnd?: (opts?: { animated?: boolean }) => void;
  scrollToOffset?: (opts: { offset: number; animated?: boolean }) => void;
};

/**
 * "Up" and "down" buttons for long pages. Give the ScrollView/FlatList the
 * returned `onScroll` (and `scrollEventThrottle`), and render `<ScrollJumper>`
 * over it. The buttons appear only once there is somewhere to jump to: "up"
 * after scrolling down a screen or so, "down" while the end is far away.
 */
export function useScrollJumper() {
  const [state, setState] = useState({ y: 0, viewport: 0, content: 0 });
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    setState({ y: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height });
  }, []);
  return { onScroll, state };
}

export function ScrollJumper({
  state,
  target,
  bottom = Spacing.lg,
}: {
  state: { y: number; viewport: number; content: number };
  target: React.RefObject<ScrollTarget | null>;
  /** Distance from the bottom edge, to clear a footer button or the tab bar. */
  bottom?: number;
}) {
  const theme = useTheme();
  const last = useRef(0);
  const showUp = state.y > 400;
  const showDown = state.content - (state.y + state.viewport) > 600;
  if (!showUp && !showDown) return null;

  const jump = (where: "top" | "bottom") => {
    const now = Date.now();
    if (now - last.current < 250) return;
    last.current = now;
    const t = target.current;
    if (!t) return;
    if (where === "top") {
      if (t.scrollToOffset) t.scrollToOffset({ offset: 0, animated: true });
      else t.scrollTo?.({ y: 0, animated: true });
    } else t.scrollToEnd?.({ animated: true });
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      {showUp ? (
        <Pressable
          accessibilityLabel="למעלה"
          onPress={() => jump("top")}
          style={({ pressed }) => [styles.button, Shadows.card, { backgroundColor: theme.card, opacity: pressed ? 0.7 : 0.94 }]}
        >
          <Ionicons name="chevron-up" size={22} color={theme.text} />
        </Pressable>
      ) : null}
      {showDown ? (
        <Pressable
          accessibilityLabel="למטה"
          onPress={() => jump("bottom")}
          style={({ pressed }) => [styles.button, Shadows.card, { backgroundColor: theme.card, opacity: pressed ? 0.7 : 0.94 }]}
        >
          <Ionicons name="chevron-down" size={22} color={theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Left edge: in a right-to-left layout that is the "end" side, away from the thumb's usual spot.
  wrap: { position: "absolute", left: Spacing.md, gap: Spacing.sm },
  button: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
