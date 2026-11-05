import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts, Shadows } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type Icon = ComponentProps<typeof Ionicons>["name"];

/** The slice of the navigator's tab-bar props we use (structural, so expo-router's own types fit). */
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const ICONS: Record<string, { on: Icon; off: Icon; label: string }> = {
  index: { on: "restaurant", off: "restaurant-outline", label: "מתכונים" },
  shopping: { on: "cart", off: "cart-outline", label: "קניות" },
  learn: { on: "school", off: "school-outline", label: "לימוד" },
  settings: { on: "settings", off: "settings-outline", label: "הגדרות" },
};

/** Four tabs with a permanent "+" in the middle that opens the add sheet. */
export function TabBar({ state, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => ICONS[r.name]);
  const middle = Math.ceil(routes.length / 2);

  const renderTab = (route: (typeof routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const meta = ICONS[route.name]!;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={() => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented)
            navigation.navigate(route.name);
        }}
        style={styles.tab}
      >
        <Ionicons
          name={focused ? meta.on : meta.off}
          size={24}
          color={focused ? theme.primary : theme.textMuted}
        />
        <Text
          style={[
            styles.label,
            { color: focused ? theme.primary : theme.textMuted },
          ]}
        >
          {meta.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          paddingBottom: Math.max(insets.bottom, Platform.OS === "web" ? 8 : 4),
        },
      ]}
    >
      {routes.slice(0, middle).map(renderTab)}
      <View style={styles.tab} />
      {routes.slice(middle).map(renderTab)}
      <View style={styles.addWrap} pointerEvents="box-none">
        <View style={[styles.addRing, { backgroundColor: theme.background }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="הוספת מתכון"
          onPress={() => router.push("/add" as Href)}
          style={({ pressed }) => [
            styles.add,
            Shadows.floating,
            {
              backgroundColor: theme.primary,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            },
          ]}
        >
          <Ionicons name="add" size={34} color={theme.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    overflow: "visible",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    paddingVertical: 4,
    minHeight: 56,
  },
  label: { fontSize: 11, fontFamily: Fonts.medium },
  addWrap: {
    position: "absolute",
    top: -26,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  addRing: {
    position: "absolute",
    top: -6,
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  add: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
