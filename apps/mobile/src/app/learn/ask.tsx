import { Ionicons } from "@expo/vector-icons";
import { formatQuantity, lessonById, type Ingredient, type Step } from "@recipe/shared";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Chat, type ChatLine } from "@/components/chat";
import { AppText, Button, Card, Row, Screen } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { api, type RecipeChange, type RecipeEdit } from "@/lib/api";
import { useRecipe, useSaveRecipe } from "@/lib/queries";

const LESSON_STARTERS = ["למה זה חשוב בכלל?", "מה הטעות הכי נפוצה?", "ניסיתי וזה לא יצא"];
const RECIPE_STARTERS = ["חסר לי מצרך, במה להחליף?", "אפשר להכין מראש?", "מה יוסיף לזה טעם?"];
const GENERAL_STARTERS = ["משהו חסר במנה שלי", "איך יודעים שהמחבת חמה מספיק?", "מה הולך עם מה?"];

interface Line extends ChatLine {
  /** Kort's answer holds a change that can be written into the recipe. */
  canApply?: boolean;
}

/** What the recipe held before an update, for "לבטל את השינוי". */
interface Before {
  title: string;
  ingredients: Ingredient[];
  steps: Step[];
}

/**
 * "שאלה לקורט": a question to the coach, from anywhere in the app.
 *   ?lesson=<id>             inside a lesson: answered in the lesson's context.
 *   ?recipe=<id>&servings=n  on a recipe or while cooking it: the server gives the
 *                            model the whole recipe, so a swap comes back with the
 *                            amount and the step it goes into. An answer that holds
 *                            a change gets a button that writes it into the recipe:
 *                            first a list of what will change, saved only on approval.
 *   (nothing)                a general cooking question.
 * The conversation lives only in this screen.
 */
export default function AskScreen() {
  const params = useLocalSearchParams<{ lesson?: string; recipe?: string; servings?: string }>();
  const lesson = params.lesson ? lessonById(params.lesson) : undefined;
  const { data: recipe } = useRecipe(params.recipe);
  const save = useSaveRecipe();
  const servingsParam = params.servings ? Number(params.servings) : NaN;
  const servings = Number.isFinite(servingsParam) && servingsParam > 0 ? servingsParam : null;

  const greeting = lesson
    ? `אנחנו בשיעור ${lesson.number}, "${lesson.title}". שאלו כל מה שלא ברור, או ספרו מה קרה לכם במחבת.`
    : params.recipe
      ? `אנחנו במתכון${recipe ? ` "${recipe.title}"` : ""}. שאלו על החלפת מצרך, כמויות, הכנה מראש, או מה לעשות אם משהו השתבש. אענה לפי המתכון הזה: כמה לשים ובאיזה שלב. אם תרצו, אפשר אחר כך לעדכן את המתכון לפי ההצעה.`
      : "שאלו כל שאלה על בישול: למה משהו עובד, מה השתבש, או מה לעשות אחרת.";
  const starters = lesson ? LESSON_STARTERS : params.recipe ? RECIPE_STARTERS : GENERAL_STARTERS;

  const [asked, setAsked] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Writing a suggestion into the recipe: prepared → shown → saved (or dropped).
  const [preparing, setPreparing] = useState(false);
  const [edit, setEdit] = useState<RecipeEdit | null>(null);
  const [before, setBefore] = useState<Before | null>(null);

  const forModel = (lines: Line[]) => lines.map((l) => ({ role: l.role, text: l.text }));
  const last = asked[asked.length - 1];
  const offerApply = Boolean(params.recipe && last?.role === "assistant" && last.canApply && !edit && !busy);

  async function send(text: string) {
    const next: Line[] = [...asked, { role: "user", text }];
    setAsked(next);
    setBusy(true);
    setError(null);
    setEdit(null);
    setBefore(null);
    try {
      const { reply, changes_recipe } = await api.ask(
        { lesson_id: lesson?.id ?? null, recipe_id: params.recipe ?? null, servings },
        forModel(next),
      );
      setAsked([...next, { role: "assistant", text: reply, canApply: Boolean(params.recipe) && changes_recipe }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Step one: ask the server what the suggestion changes. Nothing is saved yet. */
  async function prepare() {
    if (!params.recipe) return;
    setPreparing(true);
    setError(null);
    try {
      const prepared = await api.askApply(params.recipe, servings, forModel(asked));
      if (!prepared.changes.length) {
        setAsked([...asked, { role: "assistant", text: "לא מצאתי בשיחה שינוי שאפשר לכתוב לתוך המתכון. כתבו לי מה בדיוק לשנות ואכין את העדכון." }]);
      } else {
        setEdit(prepared);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }

  /** Step two, only on the cook's approval: the changes go into the recipe. */
  async function approve() {
    if (!params.recipe || !recipe || !edit) return;
    setError(null);
    try {
      const old: Before = { title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps };
      await save.mutateAsync({ id: params.recipe, input: edit.patch });
      setBefore(old);
      // Said in the conversation too, so a later update does not repeat these changes.
      setAsked([...asked, { role: "assistant", text: `עדכנתי את המתכון${edit.summary ? `: ${edit.summary}` : "."}` }]);
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function undo() {
    if (!params.recipe || !before) return;
    setError(null);
    try {
      await save.mutateAsync({ id: params.recipe, input: before });
      setBefore(null);
      setAsked([...asked, { role: "assistant", text: "ביטלתי את העדכון. המתכון חזר למה שהיה." }]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: lesson ? `שאלה על: ${lesson.title}` : recipe ? `שאלה על: ${recipe.title}` : "שאלה לקורט" }} />
      <Chat
        lines={[{ role: "assistant", text: greeting }, ...asked]}
        options={asked.length === 0 ? starters : []}
        busy={busy || preparing}
        busyLabel={preparing ? "מכין את העדכון למתכון…" : undefined}
        error={error}
        placeholder="מה רציתם לשאול?"
        onSend={send}
      >
        {offerApply && !preparing ? (
          <Button title="לעדכן את המתכון לפי ההצעה" icon="create-outline" variant="secondary" onPress={prepare} style={styles.offer} />
        ) : null}

        {edit ? (
          <EditPreview
            edit={edit}
            servings={recipe?.servings ?? null}
            saving={save.isPending}
            onApprove={approve}
            onDrop={() => setEdit(null)}
          />
        ) : null}

        {before && !edit ? (
          <Card flat style={styles.done}>
            <Row style={{ gap: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color="#5E8C4A" />
              <AppText variant="bodyBold" style={{ flex: 1 }}>
                המתכון עודכן
              </AppText>
            </Row>
            <Row style={{ gap: 8, flexWrap: "wrap" }}>
              <Button title="חזרה למתכון" size="sm" onPress={() => router.back()} />
              <Button title="לבטל את השינוי" size="sm" variant="ghost" loading={save.isPending} onPress={undo} />
            </Row>
          </Card>
        ) : null}
      </Chat>
    </Screen>
  );
}

/** "מה ישתנה במתכון": every line that changes, old and new, before anything is saved. */
function EditPreview({
  edit,
  servings,
  saving,
  onApprove,
  onDrop,
}: {
  edit: RecipeEdit;
  servings: number | null;
  saving: boolean;
  onApprove: () => void;
  onDrop: () => void;
}) {
  const title = edit.changes.filter((c) => c.where === "title");
  const ingredients = edit.changes.filter((c) => c.where === "ingredient");
  const steps = edit.changes.filter((c) => c.where === "step");
  return (
    <Card style={styles.preview}>
      <AppText variant="subheading">מה ישתנה במתכון</AppText>
      {edit.summary ? <AppText color="textSecondary">{edit.summary}</AppText> : null}

      {title.map((c, i) => (
        <ChangeRow key={`t${i}`} change={{ ...c, label: "שם המתכון" }} />
      ))}
      {ingredients.length ? (
        <View style={styles.group}>
          <AppText variant="label" color="textSecondary">
            מצרכים
          </AppText>
          {ingredients.map((c, i) => (
            <ChangeRow key={`i${i}`} change={c} />
          ))}
        </View>
      ) : null}
      {steps.length ? (
        <View style={styles.group}>
          <AppText variant="label" color="textSecondary">
            שלבים
          </AppText>
          {steps.map((c, i) => (
            <ChangeRow key={`s${i}`} change={c} />
          ))}
        </View>
      ) : null}

      <AppText variant="caption" color="textMuted">
        שום דבר לא נשמר עד שתאשרו. כל שאר המתכון נשאר כמו שהוא.
        {servings ? ` הכמויות כתובות ל-${formatQuantity(servings)} מנות, כמו במתכון.` : ""}
      </AppText>
      <Row style={{ gap: 8, flexWrap: "wrap" }}>
        <Button title="לשמור במתכון" icon="checkmark" loading={saving} onPress={onApprove} />
        <Button title="לא עכשיו" variant="ghost" disabled={saving} onPress={onDrop} />
      </Row>
    </Card>
  );
}

const KIND = {
  add: { icon: "add-circle", word: "נכנס" },
  remove: { icon: "remove-circle", word: "יוצא" },
  change: { icon: "swap-vertical", word: "משתנה" },
} as const;

function ChangeRow({ change }: { change: RecipeChange }) {
  const theme = useTheme();
  const kind = KIND[change.kind];
  const tint = change.kind === "remove" ? theme.danger : change.kind === "add" ? theme.accent : theme.primary;
  return (
    <View style={[styles.change, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <Row style={{ gap: 6 }}>
        <Ionicons name={kind.icon} size={16} color={tint} />
        <AppText variant="caption" style={{ color: tint }}>
          {change.label ? `${change.label}: ${kind.word}` : kind.word}
        </AppText>
      </Row>
      {change.before ? (
        <AppText color="textMuted" style={styles.old}>
          {change.before}
        </AppText>
      ) : null}
      {change.after ? <AppText>{change.after}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  offer: { alignSelf: "flex-end", marginTop: 2 },
  preview: { padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.xs },
  group: { gap: 6, marginTop: 2 },
  change: { padding: Spacing.sm + 2, borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  old: { textDecorationLine: "line-through" },
  done: { padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.xs },
});
