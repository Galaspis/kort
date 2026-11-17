import { Ionicons } from "@expo/vector-icons";
import { LESSONS, deepLesson, lessonById, type FailureLook, type GuidedDish, type RecipeRow } from "@recipe/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { createElement, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Button, Card, EmptyState, IconButton, Row, Screen } from "@/components/ui";
import { BrowningSim } from "@/components/learn/browning-sim";
import { GuidedCook } from "@/components/learn/guided-cook";
import { SteakArt, type SteakLook } from "@/components/learn/steak-art";
import { ScrollJumper, useScrollJumper } from "@/components/scroll-jumper";
import { VideoEmbed } from "@/components/video-embed";
import { Fonts, Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { goBack } from "@/lib/navigation";
import { useCompleteLesson, useLearnProgress, useRecipes } from "@/lib/queries";

type Stage = "cards" | "experiment" | "see" | "cook" | "fix" | "quiz" | "done";
const SHORT_STAGES: { key: Stage; label: string }[] = [
  { key: "cards", label: "הרעיון" },
  { key: "experiment", label: "נסו הערב" },
  { key: "quiz", label: "שאלון" },
  { key: "done", label: "סיום" },
];
/** A lesson with deep content (packages/shared/src/course-deep.ts) swaps the experiment for three fuller stages. */
const DEEP_STAGES: { key: Stage; label: string }[] = [
  { key: "cards", label: "הרעיון" },
  { key: "see", label: "לראות" },
  { key: "cook", label: "לבשל" },
  { key: "fix", label: "תקלות" },
  { key: "quiz", label: "מבחן" },
  { key: "done", label: "סיום" },
];

/** How each failure is drawn: the same steak picture as the interactive one, with the failure's numbers. */
const FAILURE_LOOKS: Record<FailureLook, SteakLook> = {
  grey: { crust: "#A39A92", greyBand: 1, center: "#B39A93", steam: 0.5, smoke: 0, liquid: 0.3 },
  flooded: { crust: "#A8998A", greyBand: 0.9, center: "#C98880", steam: 0.9, smoke: 0, liquid: 1 },
  burnt: { crust: "#17110E", greyBand: 0.08, center: "#B8404E", steam: 0, smoke: 0.9, liquid: 0, burntBits: true },
  stuck: { crust: "#8A5A2B", greyBand: 0.4, center: "#D9727A", steam: 0.1, smoke: 0, liquid: 0, torn: true },
  bitter: { crust: "#5E3414", greyBand: 0.15, center: "#D9606C", steam: 0, smoke: 0.3, liquid: 0, burntBits: true },
};

const RATINGS = [
  { value: 1, emoji: "😕", label: "לא משהו" },
  { value: 2, emoji: "🙂", label: "יצא טוב" },
  { value: 3, emoji: "🤩", label: "מצוין" },
];

/**
 * One lesson. Short format: idea cards one at a time, a kitchen experiment
 * with a checklist, a short quiz with explanations, then a summary with the
 * recipes in Kort where the principle shows up. Deep format: after the cards
 * come an interactive picture with clips, a guided cook of a real dish, the
 * common failures, and a longer quiz. "שאלה" in the top bar opens the coach.
 */
export default function LessonScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = lessonById(id ?? "");
  const deep = lesson ? deepLesson(lesson.id) : undefined;
  const { data: progress } = useLearnProgress();
  const { data: recipes } = useRecipes();
  const complete = useCompleteLesson();

  const [stage, setStage] = useState<Stage>("cards");
  const scrollRef = useRef<ScrollView>(null);
  const jumper = useScrollJumper();
  const [card, setCard] = useState(0);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [question, setQuestion] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [saved, setSaved] = useState(false);
  const [dish, setDish] = useState<GuidedDish | null>(null);
  const [cooked, setCooked] = useState(false);
  const [rating, setRating] = useState<number | null>(null);

  // The family's recipes where this lesson shows up (the React Compiler memoizes this).
  const related: RecipeRow[] =
    lesson && recipes
      ? recipes
          .filter((r) => {
            const hay = [r.title, r.category, ...r.tags, ...r.ingredients.map((i) => i.name)].join(" ");
            return lesson.keywords.some((k) => hay.includes(k));
          })
          .slice(0, 5)
      : [];

  if (!lesson) {
    return (
      <Screen>
        <EmptyState emoji="🤔" title="השיעור לא נמצא" />
      </Screen>
    );
  }

  const alreadyDone = (progress ?? []).some((p) => p.lesson_id === lesson.id);
  const nextLesson = LESSONS.find((l) => l.number === lesson.number + 1) ?? null;
  const STAGES = deep ? DEEP_STAGES : SHORT_STAGES;
  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const quiz = deep ? [...lesson.quiz, ...deep.mastery] : lesson.quiz;
  const q = quiz[question]!;
  const scorePct = Math.round((correct / quiz.length) * 100);
  const myRating = rating ?? (progress ?? []).find((p) => p.lesson_id === lesson.id)?.cook_rating ?? null;

  function go(next: Stage) {
    setStage(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function rate(value: number) {
    setRating(value);
    complete.mutate({ lessonId: lesson!.id, score: null, cookRating: value });
  }

  function answer(i: number) {
    if (picked !== null) return;
    setPicked(i);
    const ok = i === q.answer;
    if (ok) setCorrect((c) => c + 1);
    Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }

  function nextQuestion() {
    if (question + 1 < quiz.length) {
      setQuestion(question + 1);
      setPicked(null);
      return;
    }
    const finalCorrect = correct;
    setStage("done");
    if (!saved) {
      setSaved(true);
      complete.mutate({ lessonId: lesson!.id, score: Math.round((finalCorrect / quiz.length) * 100) });
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
        <Pressable
          onPress={() => router.push({ pathname: "/learn/ask", params: { lesson: lesson.id } })}
          accessibilityRole="button"
          accessibilityLabel="שאלה לקורט"
          hitSlop={6}
          style={({ pressed }) => [styles.ask, { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.primary} />
          <AppText variant="caption" color="primary">
            שאלה
          </AppText>
        </Pressable>
      </Row>

      <ScrollView ref={scrollRef} onScroll={jumper.onScroll} scrollEventThrottle={100} contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 40 }]}>
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
              ) : deep ? (
                <Button title="לראות את זה" icon="eye-outline" onPress={() => go("see")} />
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

        {/* Deep stage: see it. The interactive picture, then what it should look like in the pan. */}
        {stage === "see" && deep ? (
          <View style={{ gap: Spacing.md }}>
            <AppText color="textSecondary">{deep.visualIntro}</AppText>
            {deep.visual === "browning" ? <BrowningSim /> : null}

            <AppText variant="subheading">איך זה נראה במחבת</AppText>
            {deep.clips.map((clip) => (
              <Card key={clip.id} style={styles.clip}>
                {clip.video ? (
                  Platform.OS === "web" ? (
                    createElement("video", {
                      src: clip.video,
                      controls: true,
                      loop: true,
                      muted: true,
                      playsInline: true,
                      preload: "metadata",
                      style: { width: "100%", borderRadius: 12, backgroundColor: "black" },
                    })
                  ) : (
                    <VideoEmbed url={clip.video} />
                  )
                ) : (
                  <View style={[styles.clipEmpty, { backgroundColor: theme.elevated }]}>
                    <Ionicons name="videocam-outline" size={22} color={theme.textMuted} />
                    <AppText variant="caption" color="textMuted">
                      הסרטון בהכנה
                    </AppText>
                  </View>
                )}
                <AppText variant="label">{clip.title}</AppText>
                <AppText color="textSecondary">{clip.look}</AppText>
              </Card>
            ))}

            <Row style={{ gap: Spacing.sm }}>
              <Button title="חזרה" variant="ghost" icon="chevron-forward" onPress={() => go("cards")} />
              <View style={{ flex: 1 }} />
              <Button title="לבשל את זה" icon="flame-outline" onPress={() => go("cook")} />
            </Row>
          </View>
        ) : null}

        {/* Deep stage: cook a real dish, with stops to compare the pan with what it should be. */}
        {stage === "cook" && deep ? (
          dish ? (
            <GuidedCook
              key={dish.id}
              dish={dish}
              onBack={() => setDish(null)}
              onDone={() => {
                setCooked(true);
                setDish(null);
                go("fix");
              }}
            />
          ) : (
            <View style={{ gap: Spacing.md }}>
              <AppText color="textSecondary">
                בוחרים מנה ומבשלים אותה צעד אחר צעד. בנקודות החשובות נעצור ונשווה: מה רואים, מה שומעים.
              </AppText>
              {deep.dishes.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() => setDish(d)}
                  style={({ pressed }) => [styles.dish, Shadows.card, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={{ fontSize: 30 }}>{d.emoji}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="label">{d.title}</AppText>
                    <AppText variant="caption" color="textMuted">
                      {d.minutes} דקות · {d.servings} מנות
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      {d.why}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-back" size={18} color={theme.textMuted} />
                </Pressable>
              ))}

              {related.length ? (
                <View style={{ gap: Spacing.sm }}>
                  <AppText variant="label" color="textSecondary">
                    או מנה מהמתכונים שלכם
                  </AppText>
                  {related.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: r.id } })}
                      style={[styles.recipeRow, { backgroundColor: theme.card, borderColor: theme.border }]}
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
                </View>
              ) : null}

              <AppText variant="caption" color="textMuted" style={{ textAlign: "center" }}>
                אפשר לבשל בפעם אחרת. המבחן לא תלוי בזה.
              </AppText>
              <Row style={{ gap: Spacing.sm }}>
                <Button title="חזרה" variant="ghost" icon="chevron-forward" onPress={() => go("see")} />
                <View style={{ flex: 1 }} />
                <Button title="לתקלות הנפוצות" icon="chevron-back" variant="secondary" onPress={() => go("fix")} />
              </Row>
            </View>
          )
        ) : null}

        {/* Deep stage: what went wrong, why, and what to do. */}
        {stage === "fix" && deep ? (
          <View style={{ gap: Spacing.md }}>
            <AppText color="textSecondary">חמש התקלות שקורות לכולם. לכל אחת יש סיבה אחת ותיקון אחד.</AppText>
            {deep.failures.map((f) => (
              <Card key={f.id} style={styles.failure}>
                <View style={[styles.failureArt, { backgroundColor: theme.elevated }]}>
                  <SteakArt look={FAILURE_LOOKS[f.look]} width={150} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="label">{f.symptom}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {f.cause}
                  </AppText>
                  <AppText variant="caption" color="accent">
                    {f.fix}
                  </AppText>
                </View>
              </Card>
            ))}
            <Row style={{ gap: Spacing.sm }}>
              <Button title="חזרה" variant="ghost" icon="chevron-forward" onPress={() => go("cook")} />
              <View style={{ flex: 1 }} />
              <Button title="למבחן" icon="help-circle-outline" onPress={() => go("quiz")} />
            </Row>
          </View>
        ) : null}

        {/* Stage 3: quiz */}
        {stage === "quiz" ? (
          <View style={{ gap: Spacing.md }}>
            <Card style={styles.ideaCard}>
              <AppText variant="caption" color="textMuted">
                שאלה {question + 1} / {quiz.length}
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
              <Button title={question + 1 < quiz.length ? "השאלה הבאה" : "סיום השיעור"} icon="chevron-back" onPress={nextQuestion} />
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
                {correct} מתוך {quiz.length} נכונות
                {scorePct < 100 ? " · שווה לחזור על הכרטיסים" : ""}
              </AppText>
            </Card>

            {deep ? (
              <Card style={[styles.ideaCard, { backgroundColor: theme.accentSoft, borderColor: "transparent" }]} flat>
                <AppText variant="subheading">{cooked || myRating ? "איך יצאה המנה?" : "בישלתם את המנה?"}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {cooked || myRating
                    ? "הציון הוא רק בשבילכם: לראות בפעם הבאה מה השתפר."
                    : "כשתבשלו אותה, חזרו לכאן וסמנו איך יצא. שיעור נלמד באמת רק במחבת."}
                </AppText>
                <Row style={{ gap: 8, flexWrap: "wrap" }}>
                  {RATINGS.map((r) => (
                    <Pressable
                      key={r.value}
                      onPress={() => rate(r.value)}
                      style={[styles.rating, { backgroundColor: theme.card, borderColor: myRating === r.value ? theme.accent : theme.border }]}
                    >
                      <Text style={{ fontSize: 22 }}>{r.emoji}</Text>
                      <AppText variant="caption">{r.label}</AppText>
                    </Pressable>
                  ))}
                </Row>
                {!cooked ? <Button title="לבשל עכשיו" variant="secondary" size="sm" icon="flame-outline" onPress={() => go("cook")} /> : null}
              </Card>
            ) : null}

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

      <ScrollJumper state={jumper.state} target={scrollRef} bottom={insets.bottom + Spacing.lg} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Spacing.sm, justifyContent: "space-between" },
  stageDot: { height: 8, borderRadius: 4 },
  ask: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: Radius.pill },
  clip: { padding: Spacing.sm + 4, gap: 6 },
  clipEmpty: { height: 120, borderRadius: Radius.sm, alignItems: "center", justifyContent: "center", gap: 6 },
  dish: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  failure: { flexDirection: "row", alignItems: "center", gap: Spacing.sm + 4, padding: Spacing.sm + 4 },
  failureArt: { borderRadius: Radius.sm, paddingVertical: 4 },
  rating: { flex: 1, minWidth: 86, alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1.5 },
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
