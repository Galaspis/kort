import { lessonById } from "@recipe/shared";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Chat, type ChatLine } from "@/components/chat";
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";

/** Questions that fit most lessons; the lesson's own topic makes them specific. */
const STARTERS = ["למה זה חשוב בכלל?", "מה הטעות הכי נפוצה?", "ניסיתי וזה לא יצא"];

/**
 * "שאלה לקורט": a question while learning. The server gives the model the
 * lesson the cook is in, so "why not olive oil?" is answered in its context.
 * The conversation lives only in this screen.
 */
export default function AskScreen() {
  const { lesson: lessonId } = useLocalSearchParams<{ lesson?: string }>();
  const lesson = lessonId ? lessonById(lessonId) : undefined;
  const [lines, setLines] = useState<ChatLine[]>([
    {
      role: "assistant",
      text: lesson
        ? `אנחנו בשיעור ${lesson.number}, "${lesson.title}". שאלו כל מה שלא ברור, או ספרו מה קרה לכם במחבת.`
        : "שאלו כל שאלה על בישול: למה משהו עובד, מה השתבש, או מה לעשות אחרת.",
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const next: ChatLine[] = [...lines, { role: "user", text }];
    setLines(next);
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api.askLesson(lesson?.id ?? null, next);
      setLines([...next, { role: "assistant", text: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: lesson ? `שאלה על: ${lesson.title}` : "שאלה לקורט" }} />
      <Chat lines={lines} options={lines.length === 1 ? STARTERS : []} busy={busy} error={error} placeholder="מה רציתם לשאול?" onSend={send} />
    </Screen>
  );
}
