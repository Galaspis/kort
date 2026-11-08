import { Tabs } from "expo-router";

import { TabBar, type TabBarProps } from "@/components/tab-bar";
import { useTheme } from "@/hooks/use-theme";

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      tabBar={(props) => (
        <TabBar
          state={props.state}
          navigation={props.navigation as TabBarProps["navigation"]}
        />
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "מתכונים" }} />
      <Tabs.Screen name="plan" options={{ title: "תכנון" }} />
      <Tabs.Screen name="shopping" options={{ title: "קניות" }} />
      <Tabs.Screen name="learn" options={{ title: "לימוד" }} />
    </Tabs>
  );
}
