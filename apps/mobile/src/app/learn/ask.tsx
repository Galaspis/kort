import { lessonById } from "@recipe/shared";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Chat, type ChatLine } from "@/components/chat";
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { useRecipe } from "@/lib/queries";

const LESSON_STARTERS = ["למה זה חשוב בכלל?", "מה הטעות הכי נפוצה?", "ניסיתי וזה לא יצא"];
const RECIPE_STARTERS = ["חסר לי מצרך, במה להחליף?", "אפשר להכין מראש?", "מה יוסיף לזה טעם?"];
const GENERAL_STARTERS = ["משהו חסר במנה שלי", "איך יודעים שהמחבת חמה מספיק?", "מה הולך עם מה?"];

/**
 * "שאלה לקורט": a question to the coach, from anywhere in the app.
 *   ?lesson=<id>             inside a lesson: answered in the lesson's context.
 *   ?recipe=<id>&servings=n  on a recipe or while cooking it: the server gives the
 *                            model the whole recipe, so a swap comes back with the
 *                            amount and the step it goes into.
 *   (nothing)                a general cooking question.
 * The conversation lives only in this screen.
 */
export default function AskScreen() {
  const params = useLocalSearchParams<{ lesson?: string; recipe?: string; servings?: string }>();
  const lesson = params.lesson ? lessonById(params.lesson) : undefined;
  const { data: recipe } = useRecipe(params.recipe);
  const servings = params.servings ? Number(params.servings) : NaN;

  const greeting = lesson
    ? `אנחנו בשיעור ${lesson.number}, "${lesson.title}". שאלו כל מה שלא ברור, או ספרו מה קרה לכם במחבת.`
    : params.recipe
      ? `אנחנו במתכון${recipe ? ` "${recipe.title}"` : ""}. שאלו על החלפת מצרך, כמויות, הכנה מראש, או מה לעשות אם משהו השתבש. אענה לפי המתכון הזה: כמה לשים ובאיזה שלב.`
      : "שאלו כל שאלה על בישול: למה משהו עובד, מה השתבש, או מה לעשות אחרת.";
  const starters = lesson ? LESSON_STARTERS : params.recipe ? RECIPE_STARTERS : GENERAL_STARTERS;

  const [asked, setAsked] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const next: ChatLine[] = [...asked, { role: "user", text }];
    setAsked(next);
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api.ask(
        {
          lesson_id: lesson?.id ?? null,
          recipe_id: params.recipe ?? null,
          servings: Number.isFinite(servings) && servings > 0 ? servings : null,
        },
        next,
      );
      setAsked([...next, { role: "assistant", text: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: lesson ? `שאלה על: ${lesson.title}` : recipe ? `שאלה על: ${recipe.title}` : "שאלה לקורט" }} />
      <Chat
        lines={[{ role: "assistant", text: greeting }, ...asked]}
        options={asked.length === 0 ? starters : []}
        busy={busy}
        error={error}
        placeholder="מה רציתם לשאול?"
        onSend={send}
      />
    </Screen>
  );
}
