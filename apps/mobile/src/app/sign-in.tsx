import { Linking, Platform, StyleSheet, View } from "react-native";

import { Wordmark } from "@/components/brand";
import { AppText, Button, Card, Screen } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { isStandalone } from "@/lib/install";
import { useAuth } from "@/providers/auth";

const APP_URL = "https://kort.gallab.top/";
const LOGIN_URL = "https://auth.gallab.top/?redirect_uri=" + encodeURIComponent(APP_URL);

/**
 * Shown when the server does not recognise us: a fresh home-screen install on a phone
 * (its cookies are separate from the browser's), an expired login, or an account that
 * is not in the family allowlist. The button goes to the shared Google login, which
 * comes back here; the auth provider re-checks on its own when the app is back in front.
 */
export default function NoAccessScreen() {
  const { refresh } = useAuth();
  const standalone = Platform.OS === "web" && isStandalone();
  const openLogin = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.href = LOGIN_URL;
    else Linking.openURL(LOGIN_URL);
  };
  return (
    <Screen>
      <View style={styles.wrap}>
        <Card style={styles.card}>
          <Wordmark width={150} />
          <AppText variant="title">קורט</AppText>
          <AppText color="textSecondary">
            צריך להתחבר עם חשבון הגוגל של המשפחה כדי לראות את המתכונים.
          </AppText>
          {standalone ? (
            <AppText variant="caption" color="textMuted">
              באפליקציה שעל מסך הבית מתחברים פעם אחת בנפרד מספארי. אחרי ההתחברות חוזרים לכאן והמסך מתעדכן לבד.
            </AppText>
          ) : null}
          <Button title="התחברות" icon="log-in-outline" onPress={openLogin} />
          <Button title="כבר התחברתי, נסו שוב" variant="ghost" onPress={() => refresh()} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: Spacing.md },
  card: { padding: Spacing.lg, gap: Spacing.md, alignItems: "flex-start" },
});
