import { MEALS, addDays, courseForCategory, dayName, defaultMealFor, shortDate, toDateKey, type MealId, type RecipeRow } from "@recipe/shared";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ActionSheet } from "@/components/action-sheet";
import { AppText, Button, Chip, Row } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dialog } from "@/lib/dialog";
import { useAddPlanEntry } from "@/lib/queries";

/**
 * "לתכנון: לאיזה יום?" from a recipe page: pick a day in the next two weeks
 * and a meal; the course comes from the recipe's category.
 */
export function PlanSheet({ visible, onClose, recipe }: { visible: boolean; onClose: () => void; recipe: RecipeRow }) {
  const theme = useTheme();
  const add = useAddPlanEntry();
  const today = toDateKey(new Date());
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealId>(defaultMealFor(today));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  function pickDay(d: string) {
    setDate(d);
    setMeal(defaultMealFor(d));
  }

  async function save() {
    try {
      await add.mutateAsync({ date, meal, course: courseForCategory(recipe.category), recipe_id: recipe.id, servings: recipe.servings ?? null });
      onClose();
      dialog.alert("נוסף לתכנון", `${recipe.title} · יום ${dayName(date)} ${shortDate(date)}`);
    } catch (err) {
      dialog.alert("לא הצליח", (err as Error).message);
    }
  }

  return (
    <ActionSheet visible={visible} onClose={onClose} title={recipe.title} subtitle="לאיזה יום ולאיזו ארוחה?">
      <View style={{ gap: Spacing.sm, marginVertical: Spacing.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
          {days.map((d) => {
            const on = d === date;
            return (
              <Pressable
                key={d}
                onPress={() => pickDay(d)}
                style={[styles.day, { backgroundColor: on ? theme.primary : theme.elevated, borderColor: d === today ? theme.primary : "transparent" }]}
              >
                <Text style={{ fontSize: 12, color: on ? theme.onPrimary : theme.textSecondary }}>{d === today ? "היום" : dayName(d)}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: on ? theme.onPrimary : theme.text }}>{shortDate(d)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Row style={{ gap: 6, flexWrap: "wrap" }}>
          {MEALS.map((m) => (
            <Chip key={m.id} label={m.label} emoji={m.emoji} selected={meal === m.id} onPress={() => setMeal(m.id)} />
          ))}
        </Row>
        <AppText variant="caption" color="textMuted">
          יסומן כ{"‏"}
          {courseLabel(recipe)}. אפשר לשנות אחר כך בלשונית תכנון.
        </AppText>
        <Button title="הוספה לתכנון" icon="calendar-outline" loading={add.isPending} onPress={save} />
      </View>
    </ActionSheet>
  );
}

function courseLabel(recipe: RecipeRow) {
  const id = courseForCategory(recipe.category);
  const names: Record<string, string> = {
    salad: "סלט",
    starter: "מנה ראשונה",
    soup: "מרק",
    main: "מנה עיקרית",
    side: "תוספת",
    bread: "לחם ומאפה",
    dessert: "קינוח",
    drink: "משקה",
    other: "אחר",
  };
  return names[id] ?? "מנה";
}

const styles = StyleSheet.create({
  day: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 1.5, minWidth: 58 },
});
