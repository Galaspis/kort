import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { extractFirstUrl, type ImportJobRow } from "@recipe/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppText, Button, Card, Field, Screen } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { dialog } from "@/lib/dialog";
import { goBack } from "@/lib/navigation";

/** What the progress screen shows per server stage: emoji trio, target % and rotating captions. */
const STAGES: Record<
  string,
  { emojis: string[]; from: number; to: number; captions: string[] }
> = {
  queued: {
    emojis: ["📨", "⏳", "🍳"],
    from: 0,
    to: 12,
    captions: ["שולחים את הקישור..."],
  },
  fetching: {
    emojis: ["📱", "🎬", "📥"],
    from: 12,
    to: 40,
    captions: ["מורידים את הפוסט...", "מביאים את הסרטון..."],
  },
  analyzing: {
    emojis: ["🧅", "🥕", "🧄"],
    from: 40,
    to: 92,
    captions: [
      "מזהים מצרכים...",
      "קוראים את הכיתוב...",
      "מקשיבים להסבר...",
      "מסדרים את השלבים...",
      "מחשבים ערכים תזונתיים...",
    ],
  },
  done: { emojis: ["🍽️", "✨", "🧡"], from: 92, to: 100, captions: ["מוכן!"] },
};

export default function ImportScreen() {
  const theme = useTheme();
  const routeParams = useLocalSearchParams<{ url?: string; text?: string; planDate?: string; planMeal?: string; planCourse?: string }>();
  // On the web the link may arrive unencoded from an iOS Shortcut
  // (…/import?url=https://facebook.com/watch?v=1&ref=x), which the router
  // would cut at the first "&". Read everything after "url=" ourselves.
  const params = useMemo(() => {
    if (Platform.OS !== "web" || typeof window === "undefined")
      return routeParams;
    const raw = window.location.search;
    const at = raw.indexOf("url=");
    if (at < 0) return routeParams;
    let url = raw.slice(at + 4);
    try {
      url = decodeURIComponent(url);
    } catch {
      /* keep as-is */
    }
    return { ...routeParams, url };
  }, [routeParams]);
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [url, setUrl] = useState(params.url ?? "");
  const [text, setText] = useState(
    params.text && params.text !== params.url ? params.text : "",
  );

  const job = useQuery({
    queryKey: ["import", jobId],
    enabled: Boolean(jobId),
    queryFn: () => api.getImport(jobId!),
    refetchInterval: (q) => {
      const status = (q.state.data as ImportJobRow | undefined)?.status;
      return status === "done" || status === "failed" ? false : 1500;
    },
  });

  const start = useMutation({
    mutationFn: api.startImport,
    onSuccess: (created) => setJobId(created.id),
  });
  const { mutate: startImport } = start;

  // Shared straight from another app: start immediately.
  useEffect(() => {
    if (params.url || params.text)
      startImport({
        url: extractFirstUrl(params.url) ?? undefined,
        text: params.text || undefined,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (job.data?.status === "done" && job.data.recipe_id) {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      const id = job.data.recipe_id;
      const { planDate, planMeal, planCourse } = routeParams;
      const t = setTimeout(async () => {
        if (planDate && planMeal && planCourse) {
          // Started from the planner: put the new recipe in its slot and go back there.
          await api.addPlan({ date: planDate, meal: planMeal, course: planCourse, recipe_id: id }).catch(() => undefined);
          queryClient.invalidateQueries({ queryKey: ["plan"] });
          router.replace("/plan");
          return;
        }
        router.replace({ pathname: "/recipe/[id]", params: { id } });
      }, 900);
      return () => clearTimeout(t);
    }
  }, [job.data, queryClient, routeParams]);

  // Android without the share sheet: "Copy link" in Facebook, then this button.
  async function pasteAndImport() {
    try {
      const clip = (await Clipboard.getStringAsync()).trim();
      const link = extractFirstUrl(clip);
      if (link) {
        setUrl(link);
        startImport({ url: link });
      } else if (clip) {
        setText(clip);
        dialog.alert(
          "הודבק טקסט",
          "לא נמצא קישור בלוח, הדבקנו את הטקסט במקום. לחצו ייבוא.",
        );
      } else {
        dialog.alert(
          "הלוח ריק",
          "קודם לוחצים 'העתקת קישור' בפייסבוק או באינסטגרם, ואז חוזרים לכאן.",
        );
      }
    } catch {
      dialog.alert("אין גישה ללוח", "הדביקו את הקישור ידנית בשדה הקישור.");
    }
  }

  const failed =
    job.data?.status === "failed" ? job.data.error : start.error?.message;
  const working = start.isPending || (jobId && job.data?.status !== "failed");
  const status = job.data?.status ?? "queued";

  if (working && !failed)
    return <Progress status={status} serverText={job.data?.progress ?? null} />;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          {failed ? (
            <Card
              flat
              style={[
                styles.errorCard,
                {
                  backgroundColor: theme.warningSoft,
                  borderColor: theme.warningSoft,
                },
              ]}
            >
              <Ionicons name="alert-circle" size={22} color={theme.warning} />
              <AppText style={{ flex: 1 }}>{failed}</AppText>
            </Card>
          ) : (
            <View style={[styles.hint, { backgroundColor: theme.primarySoft }]}>
              <Text style={{ fontSize: 28 }}>✨</Text>
              <AppText style={{ flex: 1 }} color="textSecondary">
                הדביקו קישור לרילס, לפוסט בפייסבוק או לאתר, וה-AI יכתוב מתכון
                מסודר עם מצרכים, שלבים ורשימת קניות.
              </AppText>
            </View>
          )}
          <Button
            title="הדבקת קישור מהלוח וייבוא"
            icon="clipboard-outline"
            size="lg"
            onPress={pasteAndImport}
          />
          <AppText
            variant="caption"
            color="textMuted"
            style={{ textAlign: "center" }}
          >
            {"בפייסבוק או באינסטגרם: שיתוף ← העתקת קישור, ואז הכפתור הזה."}
          </AppText>
          <Field
            label="קישור"
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.instagram.com/reel/..."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{ textAlign: "left" }}
          />
          <Field
            label="או טקסט של המתכון"
            value={text}
            onChangeText={setText}
            placeholder="העתיקו לכאן את הכיתוב של הפוסט אם הקישור לא עובד"
            multiline
          />
          <Button
            title="ייבוא"
            icon="sparkles"
            size="lg"
            disabled={!url.trim() && !text.trim()}
            onPress={() =>
              startImport({
                url: extractFirstUrl(url) ?? undefined,
                text: text.trim() || undefined,
              })
            }
          />
          <AppText
            variant="caption"
            color="textMuted"
            style={{ textAlign: "center" }}
          >
            {
              'טיפ: באינסטגרם או בפייסבוק לוחצים "שיתוף" ובוחרים "קורט". זה יגיע ישר לכאן.'
            }
          </AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Bouncing ingredient emojis, a green bar that creeps forward, rotating captions. */
function Progress({
  status,
  serverText,
}: {
  status: string;
  serverText: string | null;
}) {
  const theme = useTheme();
  const stage = STAGES[status] ?? STAGES.queued!;
  const [bar] = useState(() => new Animated.Value(0));
  const [bounces] = useState(() => [0, 1, 2].map(() => new Animated.Value(1)));
  const [tick, setTick] = useState(0);

  // Creep toward the stage ceiling; jump quickly to it when the stage advances.
  useEffect(() => {
    Animated.timing(bar, {
      toValue: stage.from,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      Animated.timing(bar, {
        toValue: stage.to,
        duration: status === "done" ? 400 : 25_000,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    });
  }, [bar, stage, status]);

  // Each emoji hops in turn.
  useEffect(() => {
    const loops = bounces.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 220),
          Animated.timing(v, {
            toValue: 1.25,
            duration: 320,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 1,
            duration: 320,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(900 - i * 220),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bounces]);

  useEffect(() => {
    const t = setInterval(() => setTick((i) => i + 1), 2600);
    return () => clearInterval(t);
  }, []);

  const caption =
    status === "analyzing"
      ? stage.captions[tick % stage.captions.length]
      : (serverText ?? stage.captions[0]);
  const width = bar.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <Screen style={styles.center}>
      <View style={styles.emojiRow}>
        {stage.emojis.map((e, i) => (
          <Animated.Text
            key={`${status}-${i}`}
            style={[styles.emoji, { transform: [{ scale: bounces[i]! }] }]}
          >
            {e}
          </Animated.Text>
        ))}
      </View>
      <View style={[styles.track, { backgroundColor: theme.elevated }]}>
        <Animated.View
          style={[styles.fill, { width, backgroundColor: theme.primary }]}
        />
      </View>
      <AppText
        variant="subheading"
        color="textSecondary"
        style={{ textAlign: "center" }}
      >
        {caption}
      </AppText>
      <AppText
        variant="caption"
        color="textMuted"
        style={{ textAlign: "center", marginTop: Spacing.lg }}
      >
        בדרך כלל לוקח עד דקה. אפשר להמשיך לגלוש, המתכון יופיע ברשימה.
      </AppText>
      <Button title="להמשיך ברקע" variant="ghost" onPress={() => goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  emojiRow: { flexDirection: "row", gap: Spacing.xl, marginBottom: Spacing.md },
  emoji: { fontSize: 56 },
  track: {
    width: "100%",
    maxWidth: 420,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 4 },
  form: { padding: Spacing.md, gap: Spacing.md },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  errorCard: {
    flexDirection: "row",
    gap: Spacing.sm,
    padding: Spacing.md,
    alignItems: "center",
  },
});
