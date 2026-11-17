import { Ionicons } from "@expo/vector-icons";
import { lessonById } from "@recipe/shared";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chat } from "@/components/chat";
import { AppText, Button, Card, Row, Screen } from "@/components/ui";
import { CATEGORY_EMOJI, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { api, type ChatMsg, type ChefBuilt, type ChefProposal } from "@/lib/api";
import { dialog } from "@/lib/dialog";
import { formatMinutes, ingredientLine } from "@/lib/format";
import { keys } from "@/lib/queries";

interface Line {
  role: "user" | "assistant";
  text: string;
  proposal?: ChefProposal | null;
}

const GREETING =
  "מה מבשלים? ספרו לי מה יש בבית או מה מתחשק, לכמה אנשים, וכמה זמן יש. אפשר גם להתחיל מאחת האפשרויות ואני אשאל את השאר.";
const FIRST_OPTIONS = ["מנה אחת לארוחת ערב", "ארוחה שלמה לאורחים", "יש לי מצרך שצריך לנצל", "אין לי מושג, תפתיע"];

const BUILD_CAPTIONS = ["כותב את המתכונים…", "מחשב כמויות לפי מספר הסועדים…", "בודק מתי המלח ומתי החומצה…", "מסדר את סדר העבודה…"];

/** What the model should remember of an earlier proposal: the gist, not the whole card. */
function forModel(lines: Line[]): ChatMsg[] {
  return lines.map((l) => ({
    role: l.role,
    text: l.proposal
      ? `${l.text}\n[ההצעה שהוצגה: ${l.proposal.title}, ל-${l.proposal.servings} סועדים. ${l.proposal.dishes.map((d) => `${d.role}: ${d.name} (${d.idea})`).join("; ")}]`
      : l.text,
  }));
}

function LessonTag({ id }: { id: string | null }) {
  const lesson = id ? lessonById(id) : undefined;
  if (!lesson) return null;
  return (
    <Pressable onPress={() => router.push({ pathname: "/learn/[id]", params: { id: lesson.id } })} hitSlop={6}>
      <AppText variant="caption" color="primary">
        שיעור {lesson.number}: {lesson.title} ‹
      </AppText>
    </Pressable>
  );
}

/**
 * "לבשל עם קורט": the cook and the model build a dish or a meal together.
 * The model asks one thing at a time (tappable answers), proposes, and on
 * approval writes full recipes that are saved like any other recipe, with the
 * "why it works" notes attached. Nothing is kept until the cook saves.
 */
export default function ChefScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Line[]>([{ role: "assistant", text: GREETING }]);
  const [options, setOptions] = useState<string[]>(FIRST_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [caption, setCaption] = useState(0);
  const [built, setBuilt] = useState<ChefBuilt | null>(null);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // Rotating captions while the recipes are being written (it takes up to a minute).
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => setCaption((c) => (c + 1) % BUILD_CAPTIONS.length), 4000);
    return () => clearInterval(t);
  }, [building]);

  const proposal = [...lines].reverse().find((l) => l.role === "assistant")?.proposal ?? null;

  async function send(text: string) {
    const next: Line[] = [...lines, { role: "user", text }];
    setLines(next);
    setOptions([]);
    setBusy(true);
    setError(null);
    try {
      const turn = await api.chefTurn(forModel(next));
      if (!alive.current) return;
      setLines([...next, { role: "assistant", text: turn.say, proposal: turn.proposal }]);
      // With a proposal on screen the yes is the button on the card; the chips are the changes.
      setOptions(turn.proposal ? turn.options.filter((o) => !/תבנה|לבנות/.test(o)) : turn.options);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function build() {
    if (!proposal) return;
    setBuilding(true);
    setCaption(0);
    setError(null);
    try {
      const result = await api.chefBuild(forModel(lines), proposal);
      if (alive.current) setBuilt(result);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBuilding(false);
    }
  }

  async function save() {
    if (!built) return;
    setSaving(true);
    try {
      const rows = [];
      for (const dish of built.dishes) {
        rows.push(await api.createRecipe({ ...dish.recipe, why: dish.why }));
      }
      // A stock photo for each, in the background; the list refreshes when they arrive.
      for (const row of rows) {
        api
          .findImage(row.id)
          .then(() => queryClient.invalidateQueries({ queryKey: keys.recipes }))
          .catch(() => undefined);
      }
      await queryClient.invalidateQueries({ queryKey: keys.recipes });
      if (rows.length === 1) router.replace({ pathname: "/recipe/[id]", params: { id: rows[0]!.id } });
      else {
        dialog.alert("נשמר", `${rows.length} מתכונים נוספו לספר המתכונים.`);
        router.replace("/");
      }
    } catch (e) {
      dialog.alert("השמירה נכשלה", (e as Error).message);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  // ----- the finished dish or meal -----
  if (built) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={[styles.result, { paddingBottom: insets.bottom + 110 }]}>
          <View>
            <AppText variant="caption" color="primary">
              בנינו ביחד
            </AppText>
            <AppText variant="title">{proposal?.title ?? built.dishes[0]!.recipe.title}</AppText>
          </View>

          {built.timeline.length ? (
            <Card style={[styles.card, { backgroundColor: theme.accentSoft, borderColor: "transparent" }]} flat>
              <AppText variant="subheading">סדר העבודה</AppText>
              {built.timeline.map((t, i) => (
                <Row key={i} style={{ gap: Spacing.sm, alignItems: "flex-start" }}>
                  <AppText variant="label" color="accent" style={{ width: 96 }}>
                    {t.when}
                  </AppText>
                  <AppText style={{ flex: 1 }}>{t.text}</AppText>
                </Row>
              ))}
            </Card>
          ) : null}

          {built.dishes.map(({ recipe, why }, d) => (
            <Card key={d} style={styles.card}>
              <Row style={{ gap: Spacing.sm }}>
                <Text style={{ fontSize: 28 }}>{CATEGORY_EMOJI[recipe.category] ?? "🍽️"}</Text>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading">{recipe.title}</AppText>
                  <AppText variant="caption" color="textMuted">
                    {[
                      recipe.servings ? `${recipe.servings} מנות` : null,
                      formatMinutes((recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0) || null),
                      recipe.difficulty,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </AppText>
                </View>
              </Row>
              {recipe.description ? <AppText color="textSecondary">{recipe.description}</AppText> : null}

              <AppText variant="label" color="primary" style={styles.section}>
                מצרכים
              </AppText>
              {recipe.ingredients.map((ing, i) => (
                <Row key={i} style={{ gap: 8, alignItems: "flex-start" }}>
                  <View style={[styles.bullet, { backgroundColor: theme.beige }]} />
                  <AppText style={{ flex: 1 }}>{ingredientLine(ing)}</AppText>
                </Row>
              ))}

              <AppText variant="label" color="primary" style={styles.section}>
                הכנה
              </AppText>
              {recipe.steps.map((step, i) => (
                <Row key={i} style={{ gap: Spacing.sm, alignItems: "flex-start" }}>
                  <View style={[styles.num, { backgroundColor: theme.elevated }]}>
                    <AppText variant="caption" color="textSecondary">
                      {i + 1}
                    </AppText>
                  </View>
                  <AppText style={{ flex: 1 }}>{step.text}</AppText>
                </Row>
              ))}

              {why.length ? (
                <View style={[styles.why, { backgroundColor: theme.background }]}>
                  <AppText variant="label" color="accent">
                    למה זה עובד
                  </AppText>
                  {why.map((note, i) => (
                    <View key={i} style={{ gap: 2 }}>
                      <AppText color="textSecondary">{note.text}</AppText>
                      <LessonTag id={note.lesson_id} />
                    </View>
                  ))}
                </View>
              ) : null}

              {recipe.warnings.length ? (
                <View style={[styles.why, { backgroundColor: theme.warningSoft }]}>
                  <AppText variant="label" style={{ color: theme.warning }}>
                    שימו לב
                  </AppText>
                  {recipe.warnings.map((w, i) => (
                    <AppText key={i} variant="caption" color="textSecondary">
                      {w}
                    </AppText>
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: insets.bottom + Spacing.sm }]}>
          <Button title="חזרה לשיחה" variant="ghost" icon="chevron-forward" onPress={() => setBuilt(null)} disabled={saving} />
          <View style={{ flex: 1 }} />
          <Button
            title={built.dishes.length > 1 ? `לשמור ${built.dishes.length} מתכונים` : "לשמור למתכונים"}
            icon="bookmark-outline"
            loading={saving}
            onPress={save}
          />
        </View>
      </Screen>
    );
  }

  // ----- the conversation -----
  return (
    <Screen>
      <Chat
        lines={lines}
        options={building ? [] : options}
        busy={busy || building}
        busyLabel={building ? BUILD_CAPTIONS[caption] : "קורט חושב…"}
        error={error}
        placeholder={proposal ? "רוצים לשנות משהו? כתבו כאן" : "מה יש בבית? מה מתחשק?"}
        onSend={send}
      >
        {proposal && !busy && !building ? (
          <Card style={[styles.card, { borderColor: theme.primary, borderWidth: 1.5 }]}>
            <Row style={{ justifyContent: "space-between" }}>
              <AppText variant="caption" color="primary">
                ההצעה
              </AppText>
              <AppText variant="caption" color="textMuted">
                ל-{proposal.servings} סועדים
              </AppText>
            </Row>
            <AppText variant="heading">{proposal.title}</AppText>
            {proposal.dishes.map((dish, i) => (
              <View key={i} style={{ gap: 2 }}>
                <AppText variant="label">
                  {dish.name}
                  <AppText variant="caption" color="textMuted">
                    {"  "}
                    {dish.role}
                  </AppText>
                </AppText>
                <AppText color="textSecondary">{dish.idea}</AppText>
              </View>
            ))}
            <View style={[styles.why, { backgroundColor: theme.background }]}>
              <AppText variant="label" color="accent">
                למה זה בנוי נכון
              </AppText>
              {proposal.principles.map((p, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <Row style={{ gap: 8, alignItems: "flex-start" }}>
                    <Ionicons name="checkmark" size={16} color={theme.accent} style={{ marginTop: 4 }} />
                    <AppText color="textSecondary" style={{ flex: 1 }}>
                      {p.text}
                    </AppText>
                  </Row>
                  <View style={{ paddingStart: 24 }}>
                    <LessonTag id={p.lesson_id} />
                  </View>
                </View>
              ))}
            </View>
            <Button title="נשמע טוב, לבנות את המתכון" icon="restaurant-outline" onPress={build} />
          </Card>
        ) : null}
      </Chat>
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { padding: Spacing.md, gap: Spacing.md },
  card: { padding: Spacing.md, gap: Spacing.sm },
  section: { marginTop: Spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 1 },
  why: { padding: Spacing.sm + 4, borderRadius: Radius.sm, gap: 8, marginTop: Spacing.sm },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
