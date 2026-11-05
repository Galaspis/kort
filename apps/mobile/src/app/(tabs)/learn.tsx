import { Ionicons } from "@expo/vector-icons";
import { FIXES, LESSONS, LEVELS, lessonById, type CourseLevel } from "@recipe/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet } from "@/components/action-sheet";
import { AppText, Button, Card, Row, Screen } from "@/components/ui";
import { Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dialog } from "@/lib/dialog";
import { useLearnProgress, useResetLearning } from "@/lib/queries";

/**
 * The course overview: progress, the "something is missing" tool, and the
 * 24 lessons in three levels. Tapping a lesson opens it.
 */
export default function LearnScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useLearnProgress();
  const reset = useResetLearning();
  const [fixOpen, setFixOpen] = useState(false);
  const [fixId, setFixId] = useState<string | null>(null);

  const done = new Map((data ?? []).map((p) => [p.lesson_id, p]));
  const next = LESSONS.find((l) => !done.has(l.id)) ?? null;
  const fix = FIXES.find((f) => f.id === fixId) ?? null;
  const fixLesson = fix ? lessonById(fix.lesson) : undefined;

  function levelDone(level: CourseLevel) {
    const inLevel = LESSONS.filter((l) => l.level === level);
    return { done: inLevel.filter((l) => done.has(l.id)).length, total: inLevel.length };
  }

  async function confirmReset() {
    const ok = await dialog.confirm("להתחיל את הקורס מההתחלה?", "ההתקדמות שלכם תימחק (רק שלכם, לא של שאר המשפחה).", {
      confirmText: "איפוס",
      destructive: true,
    });
    if (ok) reset.mutate();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
        <View>
          <AppText variant="display">ללמוד לבשל</AppText>
          <AppText variant="caption" color="textSecondary">
            מה קורה בסיר, ולמה. 24 שיעורים קצרים, ניסוי לכל שיעור.
          </AppText>
        </View>

        {/* Progress */}
        <Card style={[styles.hero, { backgroundColor: theme.primarySoft, borderColor: "transparent" }]} flat>
          <Row style={{ gap: Spacing.md }}>
            <Text style={{ fontSize: 40 }}>{next?.emoji ?? "🎓"}</Text>
            <View style={{ flex: 1 }}>
              <AppText variant="heading">{done.size === 0 ? "ללמוד לבשל" : `${done.size} מתוך ${LESSONS.length} שיעורים`}</AppText>
              <AppText color="textSecondary">
                {next
                  ? `השיעור הבא: ${next.title} · ${next.minutes} דקות`
                  : "סיימתם את כל הקורס. אפשר לחזור על כל שיעור."}
              </AppText>
            </View>
          </Row>
          <View style={[styles.bar, { backgroundColor: theme.card }]}>
            <View style={[styles.barFill, { backgroundColor: theme.primary, width: `${Math.round((done.size / LESSONS.length) * 100)}%` }]} />
          </View>
          {next ? (
            <Button
              title={done.size === 0 ? "להתחיל" : "להמשיך"}
              icon="play"
              onPress={() => router.push({ pathname: "/learn/[id]", params: { id: next.id } })}
            />
          ) : null}
        </Card>

        {/* The fixer */}
        <Pressable onPress={() => setFixOpen(true)} style={[styles.tool, Shadows.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
            <Text style={{ fontSize: 22 }}>🥄</Text>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="label">משהו חסר במנה?</AppText>
            <AppText variant="caption" color="textSecondary">
              אומרים מה לא בסדר, מקבלים מה להוסיף ולמה
            </AppText>
          </View>
          <Ionicons name="chevron-back" size={18} color={theme.textMuted} />
        </Pressable>

        {/* Levels */}
        {LEVELS.map((level) => {
          const stat = levelDone(level.id);
          return (
            <View key={level.id} style={{ gap: Spacing.sm }}>
              <Row style={{ justifyContent: "space-between", marginTop: Spacing.sm }}>
                <Row style={{ gap: 8 }}>
                  <Text style={{ fontSize: 20 }}>{level.emoji}</Text>
                  <View>
                    <AppText variant="heading">{level.title}</AppText>
                    <AppText variant="caption" color="textSecondary">
                      {level.subtitle}
                    </AppText>
                  </View>
                </Row>
                <AppText variant="caption" color={stat.done === stat.total ? "accent" : "textMuted"}>
                  {stat.done === stat.total ? "הושלם ✓" : `${stat.done}/${stat.total}`}
                </AppText>
              </Row>
              {LESSONS.filter((l) => l.level === level.id).map((lesson) => {
                const finished = done.get(lesson.id);
                const isNext = next?.id === lesson.id;
                return (
                  <Pressable
                    key={lesson.id}
                    onPress={() => router.push({ pathname: "/learn/[id]", params: { id: lesson.id } })}
                    style={({ pressed }) => [
                      styles.lesson,
                      !finished && Shadows.card,
                      {
                        backgroundColor: finished ? "transparent" : theme.card,
                        borderColor: isNext ? theme.primary : theme.border,
                        borderWidth: isNext ? 1.5 : StyleSheet.hairlineWidth,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.number, { backgroundColor: finished ? theme.accent : theme.elevated }]}>
                      {finished ? (
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      ) : (
                        <AppText variant="caption" color="textSecondary">
                          {lesson.number}
                        </AppText>
                      )}
                    </View>
                    <Text style={{ fontSize: 22, opacity: finished ? 0.6 : 1 }}>{lesson.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <AppText variant="label" color={finished ? "textSecondary" : "text"} numberOfLines={1}>
                        {lesson.title}
                      </AppText>
                      <AppText variant="caption" color="textMuted" numberOfLines={1}>
                        {lesson.minutes} דק׳ · {lesson.subtitle}
                      </AppText>
                    </View>
                    {isNext ? (
                      <AppText variant="caption" color="primary">
                        הבא
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        {done.size > 0 ? (
          <Button title="להתחיל מההתחלה" variant="ghost" size="sm" icon="refresh-outline" onPress={confirmReset} />
        ) : null}
      </ScrollView>

      {/* "Something is missing": pick a symptom, get the fix */}
      <ActionSheet
        visible={fixOpen}
        title={fix ? `${fix.emoji} ${fix.symptom}` : "מה לא בסדר במנה?"}
        onClose={() => {
          setFixOpen(false);
          setFixId(null);
        }}
      >
        {fix ? (
          <View style={{ gap: Spacing.sm, marginVertical: Spacing.sm }}>
            <Card style={{ padding: Spacing.md, gap: 6 }} flat>
              <AppText variant="label" color="primary">
                מה לעשות
              </AppText>
              <AppText>{fix.fix}</AppText>
              <AppText variant="label" color="primary" style={{ marginTop: 6 }}>
                למה
              </AppText>
              <AppText color="textSecondary">{fix.why}</AppText>
            </Card>
            <Row style={{ gap: Spacing.sm, justifyContent: "space-between" }}>
              <Button title="סימפטום אחר" variant="ghost" size="sm" onPress={() => setFixId(null)} />
              {fixLesson ? (
                <Button
                  title={`שיעור ${fixLesson.number}: ${fixLesson.title}`}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setFixOpen(false);
                    setFixId(null);
                    setTimeout(() => router.push({ pathname: "/learn/[id]", params: { id: fixLesson.id } }), 150);
                  }}
                />
              ) : null}
            </Row>
          </View>
        ) : (
          <View style={{ gap: 6, marginVertical: Spacing.sm }}>
            {FIXES.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => setFixId(f.id)}
                style={({ pressed }) => [styles.symptom, { backgroundColor: pressed ? theme.elevated : "transparent", borderColor: theme.border }]}
              >
                <Text style={{ fontSize: 20 }}>{f.emoji}</Text>
                <AppText style={{ flex: 1 }}>{f.symptom}</AppText>
                <Ionicons name="chevron-back" size={16} color={theme.textMuted} />
              </Pressable>
            ))}
          </View>
        )}
      </ActionSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 120 },
  hero: { padding: Spacing.md, gap: Spacing.md },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  lesson: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  symptom: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 2,
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
