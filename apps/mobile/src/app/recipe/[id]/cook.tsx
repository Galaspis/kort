import { Ionicons } from "@expo/vector-icons";
import { ingredientsForStep } from "@recipe/shared";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppText,
  Button,
  Card,
  IconButton,
  Loading,
  Row,
  Screen,
} from "@/components/ui";
import { Fonts, Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  formatQuantity,
  formatSeconds,
  ingredientLine,
  parseDurationFromText,
  scaleIngredient,
  scaleText,
} from "@/lib/format";
import { itemEmoji } from "@/lib/ingredients";
import { goBack } from "@/lib/navigation";
import { useHoldScreenOn } from "@/lib/screen-on";
import { useMarkCooked, useRecipe } from "@/lib/queries";

/**
 * Cooking mode: screen stays on, one step at a time in big type, a timer
 * for any step that has a duration. The ingredients the step talks about
 * sit right under it with their (scaled) amounts, and the whole list folds
 * open below, so there is no jumping back to the recipe page mid-cooking.
 */
export default function CookScreen() {
  useKeepAwake();
  useHoldScreenOn();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, servings } = useLocalSearchParams<{
    id: string;
    servings?: string;
  }>();
  const { data: recipe } = useRecipe(id);
  const markCooked = useMarkCooked();
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [done, setDone] = useState(false);

  const factor = useMemo(() => {
    const target = servings ? Number(servings) : null;
    return recipe?.servings && target ? target / recipe.servings : 1;
  }, [recipe, servings]);
  const scaled = useMemo(
    () => (recipe?.ingredients ?? []).map((ing) => scaleIngredient(ing, factor)),
    [recipe, factor],
  );
  const stepIngredients = useMemo(
    () => (recipe?.steps ?? []).map((s) => ingredientsForStep(s, recipe?.ingredients ?? [])),
    [recipe],
  );

  if (!recipe) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const steps = recipe.steps;
  const step = steps[index]!;
  const duration = step.duration_seconds ?? parseDurationFromText(step.text);
  const isLast = index === steps.length - 1;
  const mentioned = stepIngredients[index] ?? [];
  const target = servings ? Number(servings) : recipe.servings;

  function finish() {
    markCooked.mutate(recipe!);
    setDone(true);
  }

  if (done) {
    return (
      <Screen style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={{ fontSize: 88 }}>🎉</Text>
        <AppText variant="display" style={{ textAlign: "center" }}>
          בתיאבון!
        </AppText>
        <AppText color="textSecondary" style={{ textAlign: "center" }}>
          סימנו שבישלתם את {recipe.title}
        </AppText>
        <Button
          title="חזרה למתכון"
          size="lg"
          onPress={() => goBack()}
          style={{ marginTop: Spacing.lg }}
        />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <Row style={styles.topBar}>
        <IconButton icon="close" circle onPress={() => goBack()} />
        <View style={{ flex: 1, gap: 8 }}>
          <AppText
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={{ textAlign: "center" }}
          >
            {recipe.title}
          </AppText>
          <Row style={{ gap: 4 }}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: i <= index ? theme.primary : theme.border,
                  },
                ]}
              />
            ))}
          </Row>
        </View>
        <IconButton
          icon={showIngredients ? "list-circle" : "list"}
          color={showIngredients ? "primary" : "text"}
          circle
          accessibilityLabel="כל המצרכים"
          onPress={() => setShowIngredients((v) => !v)}
        />
      </Row>

      <ScrollView contentContainerStyle={styles.stepBody}>
        <Row style={{ justifyContent: "space-between" }}>
          <View
            style={[styles.stepBadge, { backgroundColor: theme.primarySoft }]}
          >
            <Text style={[styles.stepBadgeText, { color: theme.primary }]}>
              שלב {index + 1} מתוך {steps.length}
              {step.group ? ` · ${step.group}` : ""}
            </Text>
          </View>
          {target && factor !== 1 ? (
            <AppText variant="caption" color="textMuted">
              ל-{formatQuantity(target)} מנות
            </AppText>
          ) : null}
        </Row>
        <AppText style={styles.stepText}>{scaleText(step.text, factor)}</AppText>

        {mentioned.length ? (
          <View style={{ gap: Spacing.sm }}>
            <AppText variant="caption" color="textMuted">
              המצרכים לשלב הזה
            </AppText>
            {mentioned.map((i) => {
              const ing = scaled[i]!;
              const qty = [formatQuantity(ing.quantity), ing.unit].filter(Boolean).join(" ");
              return (
                <Row key={i} style={[styles.mentioned, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={{ fontSize: 22 }}>{itemEmoji(ing.name, ing.aisle)}</Text>
                  <AppText style={{ flex: 1, fontSize: 18, lineHeight: 26 }}>
                    {qty ? <AppText variant="bodyBold" style={{ fontSize: 18, lineHeight: 26 }}>{qty} </AppText> : null}
                    {ing.name}
                    {ing.note ? (
                      <AppText color="textMuted" style={{ fontSize: 15 }}>
                        {" "}({ing.note})
                      </AppText>
                    ) : null}
                  </AppText>
                </Row>
              );
            })}
          </View>
        ) : null}

        {duration ? <StepTimer key={index} seconds={duration} /> : null}

        <Pressable onPress={() => setShowIngredients((v) => !v)} style={styles.foldHeader}>
          <Text style={{ fontSize: 16 }}>🧺</Text>
          <AppText variant="label" color="textSecondary" style={{ flex: 1 }}>
            כל המצרכים ({recipe.ingredients.length})
          </AppText>
          <Ionicons name={showIngredients ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
        </Pressable>
        {showIngredients ? (
          <View style={{ gap: 6 }}>
            {scaled.map((ing, i) => (
              <Card key={i} flat style={[styles.allItem, mentioned.includes(i) && { borderColor: theme.primary }]}>
                <Text style={{ fontSize: 16 }}>{itemEmoji(ing.name, ing.aisle)}</Text>
                <AppText style={{ flex: 1 }}>
                  {ing.group ? (
                    <AppText variant="caption" color="primary">
                      {ing.group} ·{" "}
                    </AppText>
                  ) : null}
                  {ingredientLine(ing)}
                </AppText>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Row style={[styles.nav, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Button
          title="הקודם"
          icon="arrow-forward"
          variant="ghost"
          disabled={index === 0}
          onPress={() => setIndex((i) => i - 1)}
          style={{ flex: 1 }}
        />
        <Button
          title={isLast ? "סיימתי!" : "השלב הבא"}
          icon={isLast ? "checkmark" : "arrow-back"}
          size="lg"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (isLast) finish();
            else setIndex((i) => i + 1);
          }}
          style={{ flex: 2 }}
        />
      </Row>
    </Screen>
  );
}

function StepTimer({ seconds }: { seconds: number }) {
  const theme = useTheme();
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    interval.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          Vibration.vibrate([0, 500, 300, 500, 300, 800]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, [running]);

  const finished = remaining === 0;
  const progress = 1 - remaining / seconds;

  return (
    <Card
      style={[
        styles.timer,
        finished && { borderColor: theme.accent, borderWidth: 2 },
      ]}
    >
      <Row style={{ justifyContent: "space-between" }}>
        <View>
          <AppText variant="caption" color="textMuted">
            {finished ? "הזמן נגמר!" : running ? "רץ..." : "טיימר לשלב הזה"}
          </AppText>
          <Text
            style={[
              styles.timerText,
              { color: finished ? theme.accent : theme.text },
            ]}
          >
            {formatSeconds(remaining)}
          </Text>
        </View>
        <Row style={{ gap: Spacing.sm }}>
          <Pressable
            onPress={() => {
              setRunning(false);
              setRemaining(seconds);
            }}
            style={[styles.timerButton, { backgroundColor: theme.elevated }]}
          >
            <Ionicons name="refresh" size={22} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => !finished && setRunning((r) => !r)}
            style={[
              styles.timerButton,
              Shadows.floating,
              {
                backgroundColor: finished ? theme.accent : theme.primary,
                width: 68,
              },
            ]}
          >
            <Ionicons
              name={finished ? "checkmark" : running ? "pause" : "play"}
              size={26}
              color={theme.onPrimary}
            />
          </Pressable>
        </Row>
      </Row>
      <View style={[styles.timerBar, { backgroundColor: theme.elevated }]}>
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              width: `${progress * 100}%`,
              backgroundColor: finished ? theme.accent : theme.primary,
            },
          ]}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  topBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  progressDot: { flex: 1, height: 5, borderRadius: 3 },
  stepBody: { padding: Spacing.lg, gap: Spacing.lg, flexGrow: 1 },
  stepBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  stepBadgeText: { fontFamily: Fonts.bold, fontSize: 13 },
  stepText: { fontSize: 30, lineHeight: 44, fontFamily: Fonts.medium },
  mentioned: {
    gap: Spacing.sm + 4,
    padding: Spacing.sm + 4,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  foldHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  allItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 2,
    padding: Spacing.sm + 2,
  },
  nav: { gap: Spacing.sm, padding: Spacing.md },
  timer: { padding: Spacing.md, gap: Spacing.md },
  timerText: {
    fontSize: 44,
    lineHeight: 50,
    fontFamily: Fonts.black,
    fontVariant: ["tabular-nums"],
  },
  timerBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  timerButton: {
    height: 52,
    width: 52,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
