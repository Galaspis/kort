import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { goBack } from "@/lib/navigation";

/** The "+" sheet: import a link, write a recipe, or build one with the coach. Opens over whatever screen is active. */
export default function AddScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  function choose(path: "/import" | "/recipe/new" | "/chef") {
    router.replace(path);
  }

  return (
    <Pressable
      style={[styles.backdrop, { backgroundColor: theme.overlay }]}
      onPress={() => goBack()}
    >
      <Pressable
        style={[
          styles.sheet,
          {
            backgroundColor: theme.card,
            paddingBottom: insets.bottom + Spacing.lg,
          },
        ]}
        onPress={(e) => e.stopPropagation()}
      >
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        <AppText variant="heading" style={{ textAlign: "center" }}>
          הוספת מתכון
        </AppText>
        <Pressable
          onPress={() => choose("/import")}
          style={({ pressed }) => [
            styles.option,
            { backgroundColor: theme.elevated, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: theme.primary }]}>
            <Ionicons name="link" size={22} color={theme.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyBold">ייבוא מקישור</AppText>
            <AppText variant="caption" color="textSecondary">
              רילס, פוסט בפייסבוק או אתר. ה-AI כותב את המתכון
            </AppText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => choose("/recipe/new")}
          style={({ pressed }) => [
            styles.option,
            { backgroundColor: theme.elevated, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: theme.accent }]}>
            <Ionicons name="create" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyBold">כתיבת מתכון</AppText>
            <AppText variant="caption" color="textSecondary">
              מהראש, מהמחברת של סבתא או מספר בישול
            </AppText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => choose("/chef")}
          style={({ pressed }) => [
            styles.option,
            { backgroundColor: theme.elevated, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: theme.warning }]}>
            <Ionicons name="chatbubbles" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyBold">לבשל עם קורט</AppText>
            <AppText variant="caption" color="textSecondary">
              בלי מתכון: קורט שואל מה יש ולכמה, ובונים יחד מנה או ארוחה
            </AppText>
          </View>
        </Pressable>
        <Button title="ביטול" variant="ghost" onPress={() => goBack()} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 4,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
