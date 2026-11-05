import { Ionicons } from "@expo/vector-icons";
import { LESSONS, lessonById, type RecipeRow } from "@recipe/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button, Card, EmptyState, IconButton, Row, Screen } from "@/components/ui";
import { Fonts, Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { goBack } from "@/lib/navigation";
import { useCompleteLesson, useLearnProgress, useRecipes } from "@/lib/queries";

type Stage = "cards" | "experiment" | "quiz" | "done";
const STAGES: { key: Stage; label: string }[] = [
  { key: "cards", label: "הרעיון" },
  { key: "experiment", label: "נסו הערב" },
  { key: "quiz", label: "שאלון" },
  { key: "done", label: "סיום" },
];

/**
 * One lesson: idea cards one at a time, a kitchen experiment with a checklist,
 * a short quiz with explanations, then a summary with the recipes in Kort
 * where the principle shows up.
 */
export default function LessonScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = lessonById(id ?? "");
  const { data: progress } = useLearnProgress();
  const { data: recipes } = useRecipes();
  const complete = useCompleteLesson();

  const [stage, setStage] = useState<Stage>("cards");
  const [card, setCard] = useState(0);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [question, setQuestion] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [saved, setSaved] = useState(false);

  const related = useMemo(() => {
    if (!lesson || !recipes) return [] as RecipeRow[];
    return recipes
      .filter((r) => {
        const hay = [r.title, r.category, ...r.tags, ...r.ingredients.map((i) => i.name)].join(" ");
        return lesson.keywords.some((k) => hay.includes(k));
      })
      .slice(0, 5);
  }, [lesson, recipes]);

  if (!lesson) {
    return (
      <Screen>
        <EmptyState emoji="🤔" title="השיעור לא נמצא" />
      </Screen>
    );
  }

  const alreadyDone = (progress ?? []).some((p) => p.lesson_id === lesson.id);
  const nextLesson = LESSONS.find((l) => l.number === lesson.number + 1) ?? null;
  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const q = lesson.quiz[question]!;
  const scorePct = Math.round((correct / lesson.quiz.length) * 100);

  function answer(i: number) {
    if (picked !== null) return;
    setPicked(i);
    const ok = i === q.answer;
    if (ok) setCorrect((c) => c + 1);
    Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }

  function nextQuestion() {
    if (question + 1 < lesson!.quiz.length) {
      setQuestion(question + 1);
      setPicked(null);
      return;
    }
    const finalCorrect = correct;
    setStage("done");
    if (!saved) {
      setSaved(true);
      complete.mutate({ lessonId: lesson!.id, score: Math.round((finalCorrect / lesson!.quiz.length) * 100) });
    }
  }

  return (
    <Screen>
      {/* Top bar: back, stage dots */}
      <Row style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <IconButton icon="close" onPress={() => goBack("/learn")} accessibilityLabel="סגירה" />
        <Row style={{ gap: 6, flex: 1, justifyContent: "center" }}>
          {STAGES.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.stageDot,
                { backgroundColor: i <= stageIndex ? theme.primary : theme.beige, width: i === stageIndex ? 22 : 8 },
              ]}
            />
          ))}
        </Row>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}>
        <Row style={{ gap: Spacing.sm }}>
          <Text style={{ fontSize: 30 }}>{lesson.emoji}</Text>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="primary">
              שיעור {lesson.number} · {STAGES[stageIndex]!.label}
            </AppText>
            <AppText variant="heading">{lesson.title}</AppText>
          </View>
        </Row>

        {/* Stage 1: idea cards */}
        {stage === "cards" ? (
          <View style={{ gap: Spacing.md }}>
            <Card style={styles.ideaCard}>
              <AppText variant="caption" color="textMuted">
                {card + 1} / {lesson.cards.length}
              </AppText>
              <AppText variant="subheading">{lesson.cards[card]!.title}</AppText>
              <AppText style={styles.ideaText}>{lesson.cards[card]!.text}</AppText>
            </Card>
            <Row style={{ gap: 6, justifyContent: "center" }}>
              {lesson.cards.map((_, i) => (
                <Pressable key={i} onPress={() => setCard(i)} hitSlop={8}>
                  <View style={[styles.dot, { backgroundColor: i === card ? theme.primary : theme.beige }]} />
                </Pressable>
              ))}
            </Row>
            <Row style={{ gap: Spacing.sm }}>
              {card > 0 ? (
                <Button title="הקודם" variant="ghost" icon="chevron-forward" onPress={() => setCard(card - 1)} />
              ) : null}
              <View style={{ flex: 1 }} />
              {card + 1 < lesson.cards.length ? (
                <Button title="הבא" icon="chevron-back" onPress={() => setCard(card + 1)} />
              ) : (
                <Button
                  title="לניסוי"
                  icon="flask-outline"
                  onPress={() => {
                    setChecked(lesson.experiment.steps.map(() => false));
                    setStage("experiment");
                  }}
                />
              )}
            </Row>
          </View>
        ) : null}

        {/* Stage 2: the kitchen experiment */}
        {stage === "experiment" ? (
          <View style={{ gap: Spacing.md }}>
            <Card style={[styles.ideaCard, { backgroundColor: theme.accentSoft, borderColor: "transparent" }]} flat>
              <AppText variant="caption" color="accent">
                נסו הערב · 5 דקות במטבח
              </AppText>
              <AppText variant="subheading">{lesson.experiment.title}</AppText>
              <View style={{ gap: Spacing.sm, marginTop: 4 }}>
                {lesson.experiment.steps.map((step, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                    style={{ flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start" }}
                  >
                    <View
                      style={[
                        styles.check,
                        { borderColor: checked[i] ? theme.accent : theme.textMuted, backgroundColor: checked[i] ? theme.accent : "transparent" },
                      ]}
                    >
                      {checked[i] ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    </View>
                    <AppText style={{ flex: 1, textDecorationLine: checked[i] ? "line-through" : "none" }}>{step}</AppText>
                  </Pressable>
                ))}
              </View>
            </Card>
            <AppText variant="caption" color="textMuted" style={{ textAlign: "center" }}>
              אפשר לעשות את הניסוי אחר כך. השאלון לא תלוי בו.
            </AppText>
            <Row style={{ gap: Spacing.sm }}>
              <Button title="חזרה" variant="ghost" icon="chevron-forward" onPress={() => setStage("cards")} />
              <View style={{ flex: 1 }} />
              <Button title="לשאלון" icon="help-circle-outline" onPress={() => setStage("quiz")} />
            </Row>
          </View>
        ) : null}

        {/* Stage 3: quiz */}
        {stage === "quiz" ? (
          <View style={{ gap: Spacing.md }}>
            <Card style={styles.ideaCard}>
              <AppText variant="caption" color="textMuted">
                שאלה {question + 1} / {lesson.quiz.length}
              </AppText>
              <AppText variant="subheading">{q.q}</AppText>
              <View style={{ gap: Spacing.sm, marginTop: 4 }}>
                {q.options.map((opt, i) => {
                  const isAnswer = i === q.answer;
                  const chosen = picked === i;
                  const revealed = picked !== null;
                  const bg = !revealed ? theme.elevated : isAnswer ? theme.accentSoft : chosen ? theme.primarySoft : theme.elevated;
                  const border = !revealed ? theme.border : isAnswer ? theme.accent : chosen ? theme.danger : theme.border;
                  return (
                    <Pressable key={i} onPress={() => answer(i)} style={[styles.option, { backgroundColor: bg, borderColor: border }]}>
                      <AppText style={{ flex: 1 }}>{opt}</AppText>
                      {revealed && isAnswer ? <Ionicons name="checkmark-circle" size={20} color={theme.accent} /> : null}
                      {revealed && chosen && !isAnswer ? <Ionicons name="close-circle" size={20} color={theme.danger} /> : null}
                    </Pressable>
                  );
                })}
              </View>
              {picked !== null ? (
                <View style={[styles.why, { backgroundColor: theme.background }]}>
                  <AppText variant="label" color={picked === q.answer ? "accent" : "primary"}>
                    {picked === q.answer ? "נכון!" : "לא בדיוק"}
                  </AppText>
                  <AppText color="textSecondary">{q.why}</AppText>
                </View>
              ) : null}
            </Card>
            {picked !== null ? (
              <Button title={question + 1 < lesson.quiz.length ? "השאלה הבאה" : "סיום השיעור"} icon="chevron-back" onPress={nextQuestion} />
            ) : null}
          </View>
        ) : null}

        {/* Stage 4: done */}
        {stage === "done" ? (
          <View style={{ gap: Spacing.md }}>
            <Card style={[styles.ideaCard, { alignItems: "center", gap: 6 }]}>
              <Text style={{ fontSize: 44 }}>{scorePct === 100 ? "🏆" : scorePct >= 50 ? "👏" : "📖"}</Text>
              <AppText variant="heading">{alreadyDone && !saved ? "חזרתם על השיעור" : "השיעור הושלם"}</AppText>
              <AppText color="textSecondary">
                {correct} מתוך {lesson.quiz.length} נכונות
                {scorePct < 100 ? " · שווה לחזור על הכרטיסים" : ""}
              </AppText>
            </Card>

            {related.length ? (
              <View style={{ gap: Spacing.sm }}>
                <AppText variant="subheading">במתכונים שלכם זה קורה כאן</AppText>
                {related.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: r.id } })}
                    style={[styles.recipeRow, Shadows.card, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <AppText style={{ flex: 1 }} numberOfLines={1}>
                      {r.title}
                    </AppText>
                    <AppText variant="caption" color="textMuted">
                      {r.category}
                    </AppText>
                    <Ionicons name="chevron-back" size={16} color={theme.textMuted} />
                  </Pressable>
                ))}
                <AppText variant="caption" color="textMuted">
                  {'בכל מתכון יש כפתור "למה זה עובד?" מתחת לשלבי ההכנה.'}
                </AppText>
              </View>
            ) : (
              <AppText variant="caption" color="textMuted" style={{ textAlign: "center" }}>
                אין עדיין מתכון בקורט שמתאים לשיעור הזה. כשתייבאו אחד, הוא יופיע כאן.
              </AppText>
            )}

            <Row style={{ gap: Spacing.sm, justifyContent: "space-between" }}>
              <Button
                title="לחזור על הכרטיסים"
                variant="ghost"
                size="sm"
                onPress={() => {
                  setStage("cards");
                  setCard(0);
                  setQuestion(0);
                  setPicked(null);
                  setCorrect(0);
                }}
              />
              {nextLesson ? (
                <Button
                  title={`השיעור הבא: ${nextLesson.title}`}
                  icon="chevron-back"
                  size="sm"
                  onPress={() => router.replace({ pathname: "/learn/[id]", params: { id: nextLesson.id } })}
                />
              ) : (
                <Button title="לכל השיעורים" size="sm" onPress={() => router.replace("/learn")} />
              )}
            </Row>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Spacing.sm, justifyContent: "space-between" },
  stageDot: { height: 8, borderRadius: 4 },
  container: { padding: Spacing.md, gap: Spacing.md },
  ideaCard: { padding: Spacing.md + 4, gap: Spacing.sm },
  ideaText: { fontSize: 17, lineHeight: 28, fontFamily: Fonts.regular },
  dot: { width: 8, height: 8, borderRadius: 4 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  why: { padding: Spacing.sm + 4, borderRadius: Radius.sm, gap: 4, marginTop: 4 },
  recipeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
