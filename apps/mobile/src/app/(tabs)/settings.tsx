import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppText,
  Avatar,
  Button,
  Card,
  Field,
  Loading,
  Row,
  Screen,
  SectionTitle,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { api, API_URL } from "@/lib/api";
import { dialog } from "@/lib/dialog";
import { useProfile, useUpdateDisplayName } from "@/lib/queries";
import { useInstallPrompt } from "@/lib/install";
import { useAuth } from "@/providers/auth";

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { data, isLoading } = useProfile();
  const rename = useUpdateDisplayName();
  const [nameDraft, setName] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const installer = useInstallPrompt();

  useEffect(() => {
    api
      .health()
      .then(setServerOk)
      .catch(() => setServerOk(false));
  }, []);

  if (isLoading || !data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const name = nameDraft ?? data.display_name ?? "";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + Spacing.md },
        ]}
      >
        <Row style={{ gap: Spacing.md }}>
          <Avatar name={data.display_name} size={64} />
          <View style={{ flex: 1 }}>
            <AppText variant="title">{data.display_name ?? "שלום"}</AppText>
            <AppText variant="caption" color="textSecondary">
              {session?.user.email}
            </AppText>
          </View>
        </Row>

        {!installer.installed ? (
          <Card style={styles.card}>
            <SectionTitle emoji="📲">התקנת קורט על הטלפון</SectionTitle>
            {installer.canInstall ? (
              <>
                <AppText color="textSecondary">
                  {
                    'התקנה אמיתית: אייקון במסך הבית, מסך מלא, ו"קורט" מופיע בתפריט השיתוף של פייסבוק ואינסטגרם.'
                  }
                </AppText>
                <Button
                  title="התקנת קורט"
                  icon="download-outline"
                  onPress={() => installer.install()}
                />
              </>
            ) : (
              <AppText color="textSecondary" variant="caption">
                באנדרואיד: פתחו את kort.gallab.top בכרום (לא מתוך וואטסאפ או
                פייסבוק), ואז הכפתור יופיע כאן. באייפון: בספארי לוחצים שיתוף ←
                הוספה למסך הבית.
              </AppText>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <SectionTitle emoji="👨‍👩‍👧">המשפחה שלי</SectionTitle>
          <AppText color="textSecondary">
            קורט מסתנכרן אוטומטית: כל מי שבמשפחה רואה את אותם מתכונים ואת אותה
            רשימת קניות, בכל מכשיר. הכניסה היא עם חשבון הגוגל של המשפחה.
          </AppText>
          <View style={{ gap: Spacing.sm, marginTop: Spacing.xs }}>
            <AppText variant="label" color="textSecondary">
              מי במשפחה
            </AppText>
            {data.members.map((m) => (
              <Row key={m.id} style={{ gap: Spacing.sm }}>
                <Avatar name={m.display_name} size={32} />
                <AppText>{m.display_name ?? "ללא שם"}</AppText>
                {m.id === data.id ? (
                  <AppText variant="caption" color="textMuted">
                    (אני)
                  </AppText>
                ) : null}
              </Row>
            ))}
          </View>
        </Card>

        <Card style={styles.card}>
          <SectionTitle emoji="🙂">השם שלי</SectionTitle>
          <Field label="השם שמוצג למשפחה" value={name} onChangeText={setName} />
          {name.trim() && name.trim() !== data.display_name ? (
            <Button
              title="שמירה"
              variant="secondary"
              size="sm"
              loading={rename.isPending}
              onPress={() => rename.mutate(name.trim())}
            />
          ) : null}
        </Card>

        <Card style={styles.card} flat>
          <Row style={{ gap: Spacing.sm }}>
            <Ionicons
              name={
                serverOk === null
                  ? "ellipse-outline"
                  : serverOk
                    ? "checkmark-circle"
                    : "close-circle"
              }
              size={18}
              color={
                serverOk
                  ? theme.accent
                  : serverOk === false
                    ? theme.danger
                    : theme.textMuted
              }
            />
            <View style={{ flex: 1 }}>
              <AppText variant="label">שרת הייבוא</AppText>
              <AppText variant="caption" color="textMuted" numberOfLines={1}>
                {API_URL}
              </AppText>
            </View>
          </Row>
          {serverOk === false ? (
            <AppText variant="caption" color="danger">
              השרת לא זמין. ייבוא מקישורים לא יעבוד עד שהוא יעלה.
            </AppText>
          ) : null}
        </Card>

        <Button
          title="התנתקות"
          icon="log-out-outline"
          variant="ghost"
          onPress={signOut}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 },
  card: { padding: Spacing.md, gap: Spacing.sm + 4 },
});
