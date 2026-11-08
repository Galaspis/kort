import {
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_700Bold,
  Heebo_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/heebo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Stack, router } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Colors, Fonts } from "@/constants/theme";
import { useRealtimeSync } from "@/lib/queries";
import { AuthProvider, useAuth } from "@/providers/auth";

SplashScreen.preventAutoHideAsync();

// Expo Go has no share extension. The app still works there; sharing arrives
// through a deep link (exp://.../--/import?url=...) opened by an iOS Shortcut.
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Web: Hebrew, right-to-left, and a phone-width column on large screens.
if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.setAttribute("dir", "rtl");
  document.documentElement.setAttribute("lang", "he");
  const style = document.createElement("style");
  style.textContent = `
    html, body, #root { height: 100%; }
    body { margin: 0; overflow: hidden; background: #EEE5D6; -webkit-tap-highlight-color: transparent; }
    @media (prefers-color-scheme: dark) { body { background: #0F0C0A; } }
    #root { display: flex; justify-content: center; }
    #root > div { width: 100%; max-width: 560px; }
    @media (min-width: 600px) { #root > div { box-shadow: 0 0 60px rgba(0,0,0,0.18); } }
    * { font-family: ${Fonts.regular}, system-ui, sans-serif; }
    input, textarea { font-family: inherit; }
  `;
  document.head.appendChild(style);
  // Offline shell + image cache. Only in the built app, not during development.
  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

// A home-screen app (iOS/Android standalone) that is launched straight onto a
// recipe page is restoring an old session; people expect to land on the home
// screen. Links that arrive on purpose (/import from the Shortcut or share) are kept.
let coldStartHome = false;
if (Platform.OS === "web" && typeof window !== "undefined") {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const path = window.location.pathname;
  if (standalone && (path.startsWith("/recipe/") || path === "/add")) {
    coldStartHome = true;
    window.history.replaceState(null, "", "/");
  }
}

const WEEK = 1000 * 60 * 60 * 24 * 7;
const queryClient = new QueryClient({
  // Data stays usable offline for a week; it refreshes whenever we are online.
  defaultOptions: { queries: { staleTime: 30_000, gcTime: WEEK, retry: 1 } },
});
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "kort-cache",
});

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ disabled: isExpoGo }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister, maxAge: WEEK, buster: "v1" }}
        >
          <AuthProvider>
            <Navigation />
          </AuthProvider>
        </PersistQueryClientProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}

function Navigation() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? Colors.dark : Colors.light;
  const { session, loading } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const [fontsLoaded] = useFonts({
    Heebo_400Regular,
    Heebo_500Medium,
    Heebo_700Bold,
    Heebo_800ExtraBold,
  });
  useRealtimeSync(Boolean(session));

  useEffect(() => {
    if (!loading && fontsLoaded) SplashScreen.hideAsync();
  }, [loading, fontsLoaded]);

  useEffect(() => {
    if (coldStartHome && !loading && session) {
      coldStartHome = false;
      router.replace("/");
    }
  }, [loading, session]);

  // A link shared from Instagram/Facebook/anywhere lands here.
  useEffect(() => {
    if (!hasShareIntent || loading || !session) return;
    const url = shareIntent.webUrl ?? undefined;
    const text = shareIntent.text ?? undefined;
    resetShareIntent();
    if (url || text)
      router.push({ pathname: "/import", params: { url, text } });
  }, [hasShareIntent, loading, session, shareIntent, resetShareIntent]);

  if (loading || !fontsLoaded) return null;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: Fonts.bold, fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="add"
            options={{
              presentation: "transparentModal",
              animation: "fade",
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="import"
            options={{ title: "ייבוא מתכון", presentation: "modal" }}
          />
          <Stack.Screen
            name="recipe/new"
            options={{ title: "מתכון חדש", presentation: "modal" }}
          />
          <Stack.Screen
            name="recipe/[id]/index"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="recipe/[id]/edit"
            options={{ title: "עריכת מתכון", presentation: "modal" }}
          />
          <Stack.Screen
            name="recipe/[id]/cook"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="recipe/[id]/video"
            options={{ title: "סרטון", presentation: "modal" }}
          />
          <Stack.Screen name="learn/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: "הגדרות" }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
