import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { Platform } from "react-native";

import { api, type Me } from "@/lib/api";

/**
 * Who is signed in. The login itself happens on the gallab hub (Caddy + Google sign-in):
 * the API answers 401 without it, and the sign-in screen sends the person there. The app
 * shell loads without the login (since 2026-11-13) so this screen can always be shown.
 * "No session" means the server said 401.
 */
export interface Session {
  user: Me;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const HUB_LOGOUT_URL = "https://auth.gallab.top/logout";

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const user = await api.me();
      setSession({ user });
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Home-screen app on a phone: the login happens in a browser sheet on top of the app.
  // When the app comes back to the front without a session, ask the server again, so the
  // sign-in screen gives way to the recipes without a tap.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || session) return;
    const again = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    window.addEventListener("pageshow", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
      window.removeEventListener("pageshow", again);
    };
  }, [session, refresh]);

  const signOut = useCallback(async () => {
    setSession(null);
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.href = HUB_LOGOUT_URL;
  }, []);

  return <AuthContext.Provider value={{ session, loading, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
