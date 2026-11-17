import { Ionicons } from "@expo/vector-icons";
import type { GuidedDish } from "@recipe/shared";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppText, Button, Card, Row } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Counts a step's waiting time down. Optional: the step can be passed without it. */
function StepTimer({ seconds }: { seconds: number }) {
  const theme = useTheme();
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const endsAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    // Counted from a wall-clock end time, so a dimmed or backgrounded tab does not slow it down.
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.round((endsAt.current - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) setRunning(false);
    }, 500);
    return () => clearInterval(tick);
  }, [running]);

  const done = left === 0;
  return (
    <Pressable
      onPress={() => {
        if (done) {
          setLeft(seconds);
          return;
        }
        if (!running) endsAt.current = Date.now() + left * 1000;
        setRunning(!running);
      }}
      style={[styles.timer, { backgroundColor: done ? theme.accentSoft : theme.elevated }]}
    >
      <Ionicons name={done ? "checkmark-circle" : running ? "pause" : "timer-outline"} size={18} color={done ? theme.accent : theme.primary} />
      <AppText variant="label" style={{ color: done ? theme.accent : theme.text }}>
        {done ? "הזמן עבר" : clock(left)}
      </AppText>
      {!done ? (
        <AppText variant="caption" color="textMuted">
          {running ? "עצירה" : left === seconds ? "להפעיל שעון" : "להמשיך"}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/**
 * A practice dish, one step at a time. Some steps stop and ask what the cook
 * sees or hears; the answer gets a short "this is right because…" or "not yet,
 * do this" reply. Nothing blocks moving on: it is a guide, not a test.
 */
export function GuidedCook({ dish, onBack, onDone }: { dish: GuidedDish; onBack: () => void; onDone: () => void }) {
  const theme = useTheme();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, "good" | "bad">>({});

  if (!started) {
    return (
      <View style={{ gap: Spacing.md }}>
        <Card style={styles.card}>
          <Row style={{ gap: Spacing.sm }}>
            <Text style={{ fontSize: 30 }}>{dish.emoji}</Text>
            <View style={{ flex: 1 }}>
              <AppText variant="subheading">{dish.title}</AppText>
              <AppText variant="caption" color="textMuted">
                {dish.minutes} דקות · {dish.servings} מנות
              </AppText>
            </View>
          </Row>
          <AppText color="textSecondary">{dish.why}</AppText>
          <AppText variant="label" color="primary" style={{ marginTop: 4 }}>
            מה צריך
          </AppText>
          {dish.ingredients.map((line) => (
            <Row key={line} style={{ gap: 8, alignItems: "flex-start" }}>
              <View style={[styles.bullet, { backgroundColor: theme.beige }]} />
              <AppText style={{ flex: 1 }}>{line}</AppText>
            </Row>
          ))}
        </Card>
        <Row style={{ gap: Spacing.sm }}>
          <Button title="מנה אחרת" variant="ghost" icon="chevron-forward" onPress={onBack} />
          <View style={{ flex: 1 }} />
          <Button title="מתחילים לבשל" icon="flame-outline" onPress={() => setStarted(true)} />
        </Row>
      </View>
    );
  }

  const step = dish.steps[index]!;
  const answer = answers[index];
  const last = index + 1 === dish.steps.length;

  return (
    <View style={{ gap: Spacing.md }}>
      <Card style={styles.card}>
        <Row style={{ justifyContent: "space-between" }}>
          <AppText variant="caption" color="textMuted">
            שלב {index + 1} מתוך {dish.steps.length}
          </AppText>
          <AppText variant="caption" color="textMuted" numberOfLines={1}>
            {dish.title}
          </AppText>
        </Row>
        <AppText style={styles.stepText}>{step.text}</AppText>
        {step.seconds ? <StepTimer key={index} seconds={step.seconds} /> : null}
      </Card>

      {step.checkpoint ? (
        <Card style={[styles.card, { backgroundColor: theme.accentSoft, borderColor: "transparent" }]} flat>
          <AppText variant="caption" color="accent">
            עצירה: מסתכלים ומקשיבים
          </AppText>
          <AppText variant="subheading">{step.checkpoint.ask}</AppText>
          {(["good", "bad"] as const).map((kind) => {
            const option = step.checkpoint![kind];
            const chosen = answer === kind;
            return (
              <Pressable
                key={kind}
                onPress={() => setAnswers((a) => ({ ...a, [index]: kind }))}
                style={[
                  styles.option,
                  {
                    backgroundColor: theme.card,
                    borderColor: chosen ? (kind === "good" ? theme.accent : theme.warning) : theme.border,
                  },
                ]}
              >
                <AppText style={{ flex: 1 }}>{option.label}</AppText>
                {chosen ? (
                  <Ionicons name={kind === "good" ? "checkmark-circle" : "alert-circle"} size={20} color={kind === "good" ? theme.accent : theme.warning} />
                ) : null}
              </Pressable>
            );
          })}
          {answer ? (
            <View style={[styles.reply, { backgroundColor: theme.card }]}>
              <AppText variant="label" color={answer === "good" ? "accent" : "warning"}>
                {answer === "good" ? "בדיוק" : "שימו לב"}
              </AppText>
              <AppText color="textSecondary">{step.checkpoint[answer].reply}</AppText>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Row style={{ gap: Spacing.sm }}>
        <Button
          title="הקודם"
          variant="ghost"
          icon="chevron-forward"
          onPress={() => (index === 0 ? setStarted(false) : setIndex(index - 1))}
        />
        <View style={{ flex: 1 }} />
        {last ? (
          <Button title="סיימתי לבשל" icon="checkmark" onPress={onDone} />
        ) : (
          <Button title="השלב הבא" icon="chevron-back" onPress={() => setIndex(index + 1)} />
        )}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md + 4, gap: Spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  stepText: { fontSize: 19, lineHeight: 30 },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    marginTop: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  reply: { padding: Spacing.sm + 4, borderRadius: Radius.sm, gap: 4 },
});
