import { Ionicons } from "@expo/vector-icons";
import {
  COURSES,
  COURSE_ORDER,
  MEALS,
  addDays,
  courseForCategory,
  courseOf,
  dayName,
  defaultMealFor,
  mealOf,
  shortDate,
  toDateKey,
  weekDays,
  weekLabel,
  weekStart,
  type CourseId,
  type MealId,
  type MealPlanRow,
  type RecipeRow,
} from "@recipe/shared";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { DayMealPicker, pickerDays } from "@/components/plan-sheet";
import { AppText, Button, Card, Chip, IconButton, Loading, Row, Screen } from "@/components/ui";
import { Fonts, Radius, Shadows, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { api, type PlanSuggestion } from "@/lib/api";
import { dialog } from "@/lib/dialog";
import { formatMinutes, formatQuantity, scaleIngredient } from "@/lib/format";
import {
  ingredientsToShopping,
  useAddPlanEntry,
  useAddShoppingItems,
  useCopyPlanWeek,
  useDeletePlanEntry,
  usePlan,
  useRecipes,
  useSetPlanCooked,
  useUpdatePlanEntry,
  type NewShoppingItem,
} from "@/lib/queries";

type Slot = { date: string; meal: MealId; course: CourseId };

/**
 * The week: Sunday to Saturday, each day with the meals it has, each meal with
 * its courses. Entries are recipes from Kort or free-text lines.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = toDateKey(new Date());
  const [start, setStart] = useState(weekStart(today));
  const days = weekDays(start);
  const end = days[6]!;
  const { data: entries, isLoading } = usePlan(start, end);
  const { data: nextWeekEntries } = usePlan(addDays(start, 7), addDays(start, 7));
  const { data: recipes } = useRecipes();
  const add = useAddPlanEntry();
  const update = useUpdatePlanEntry();
  const remove = useDeletePlanEntry();
  const copyWeek = useCopyPlanWeek();
  const addShopping = useAddShoppingItems();
  const cooked = useSetPlanCooked();

  const [slot, setSlot] = useState<Slot | null>(null); // the add sheet
  const [picker, setPicker] = useState<Slot | null>(null); // recipe picker
  const [suggest, setSuggest] = useState<Slot | null>(null); // "תציע לי"
  const [entryMenu, setEntryMenu] = useState<MealPlanRow | null>(null);
  const [courseMenu, setCourseMenu] = useState<MealPlanRow | null>(null);
  const [moveEntry, setMoveEntry] = useState<MealPlanRow | null>(null);
  const [weekMenu, setWeekMenu] = useState(false);

  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes]);
  const byDay = useMemo(() => {
    const m = new Map<string, MealPlanRow[]>();
    for (const e of [...(entries ?? []), ...(nextWeekEntries ?? [])]) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [entries, nextWeekEntries]);

  const titleOf = (e: MealPlanRow) => e.title ?? recipeById.get(e.recipe_id ?? "")?.title ?? "מתכון שנמחק";

  // ---- adding ---------------------------------------------------------
  async function addText(s: Slot) {
    const text = await dialog.prompt("מה מבשלים? (שורה חופשית)");
    if (!text?.trim()) return;
    add.mutate({ ...s, title: text.trim() });
  }

  function addRecipe(s: Slot, recipe: RecipeRow) {
    add.mutate({ date: s.date, meal: s.meal, course: s.course === "other" ? courseForCategory(recipe.category) : s.course, recipe_id: recipe.id, servings: recipe.servings ?? null });
    setPicker(null);
    setSuggest(null);
  }

  function importInto(s: Slot) {
    router.push({ pathname: "/import", params: { planDate: s.date, planMeal: s.meal, planCourse: s.course } });
  }

  // ---- shopping --------------------------------------------------------
  async function toShopping(from: string, to: string, label: string) {
    const items: NewShoppingItem[] = [];
    let count = 0;
    for (const e of entries ?? []) {
      if (e.date < from || e.date > to || !e.recipe_id) continue;
      const r = recipeById.get(e.recipe_id);
      if (!r) continue;
      const factor = e.servings && r.servings ? e.servings / r.servings : 1;
      items.push(...ingredientsToShopping(r.ingredients.map((i) => scaleIngredient(i, factor)), { id: r.id, title: r.title }));
      count++;
    }
    if (!items.length) {
      dialog.alert("אין מה להוסיף", `אין מתכונים מקורט ב${label}. שורות חופשיות לא נכנסות לרשימה.`);
      return;
    }
    const ok = await dialog.confirm(`להוסיף ${items.length} מצרכים מ-${count} מתכונים לרשימת הקניות?`, undefined, { confirmText: "הוספה" });
    if (!ok) return;
    await addShopping.mutateAsync(items);
    dialog.alert("נוסף לרשימת הקניות", "מה שכבר היה ברשימה אוחד.");
  }

  // ---- menus -------------------------------------------------------------
  function entryActions(e: MealPlanRow): SheetAction[] {
    const recipe = e.recipe_id ? recipeById.get(e.recipe_id) : undefined;
    const actions: SheetAction[] = [];
    if (recipe)
      actions.push({ icon: "book-outline", label: "לפתוח את המתכון", run: () => router.push({ pathname: "/recipe/[id]", params: { id: recipe.id } }) });
    actions.push(
      e.cooked_at
        ? { emoji: "↩️", label: "לבטל את הסימון \"סיימנו\"", run: () => cooked.mutate({ entry: e, value: false }) }
        : { emoji: "✅", label: recipe ? "סיימנו (נספר כבישול של המתכון)" : "סיימנו", run: () => cooked.mutate({ entry: e, value: true }) },
    );
    actions.push({ emoji: courseOf(e.course).emoji, label: `סוג מנה: ${courseOf(e.course).label} (לשנות)`, run: () => setCourseMenu(e) });
    if (recipe)
      actions.push({
        icon: "people-outline",
        label: `מנות: ${e.servings ? formatQuantity(e.servings) : recipe.servings ? formatQuantity(recipe.servings) : "?"} (לשנות)`,
        run: async () => {
          const v = await dialog.prompt("כמה מנות?", String(e.servings ?? recipe.servings ?? ""));
          const n = v ? parseFloat(v.replace(",", ".")) : NaN;
          if (!Number.isNaN(n) && n > 0) update.mutate({ id: e.id, patch: { servings: n } });
        },
      });
    actions.push({
      icon: "create-outline",
      label: e.note ? `הערה: ${e.note} (לשנות)` : "הערה (למשל: להתחיל בצק בלילה)",
      run: async () => {
        const v = await dialog.prompt("הערה לשורה הזאת", e.note ?? "");
        if (v !== null) update.mutate({ id: e.id, patch: { note: v.trim() || null } });
      },
    });
    actions.push({ icon: "arrow-redo-outline", label: "להזיז ליום אחר", run: () => setMoveEntry(e) });
    actions.push({ icon: "trash-outline", label: "להסיר מהתכנון", color: theme.danger, run: () => remove.mutate(e.id) });
    return actions;
  }

  const isCurrentWeek = start === weekStart(today);
  const weekEmpty = (entries ?? []).length === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + Spacing.md }]}>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <AppText variant="display">תכנון</AppText>
            <AppText variant="caption" color="textSecondary">
              מה מבשלים השבוע, ומה צריך לקנות בשביל זה
            </AppText>
          </View>
          <IconButton icon="ellipsis-horizontal" circle accessibilityLabel="פעולות לשבוע" onPress={() => setWeekMenu(true)} />
        </Row>

        {/* Week navigator */}
        <Row style={[styles.nav, Shadows.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <IconButton icon="chevron-forward" accessibilityLabel="שבוע קודם" onPress={() => setStart(addDays(start, -7))} />
          <Pressable onPress={() => setStart(weekStart(today))} style={{ flex: 1, alignItems: "center" }}>
            <AppText variant="subheading">{weekLabel(start)}</AppText>
            <AppText variant="caption" color={isCurrentWeek ? "accent" : "primary"}>
              {isCurrentWeek ? "השבוע" : "לחזור להיום"}
            </AppText>
          </Pressable>
          <IconButton icon="chevron-back" accessibilityLabel="שבוע הבא" onPress={() => setStart(addDays(start, 7))} />
        </Row>

        {isLoading && !entries ? <Loading /> : null}

        {days.map((date) => {
          const dayEntries = byDay.get(date) ?? [];
          const isToday = date === today;
          const past = date < today;
          const mealsPresent = MEALS.filter((m) => dayEntries.some((e) => e.meal === m.id));
          const tomorrowNotes = (byDay.get(addDays(date, 1)) ?? []).filter((e) => e.note);
          return (
            <Card key={date} style={[styles.day, isToday && { borderColor: theme.primary, borderWidth: 1.5 }, past && { opacity: 0.75 }]}>
              <Row style={{ justifyContent: "space-between" }}>
                <Row style={{ gap: 8 }}>
                  <View style={[styles.dateBadge, { backgroundColor: isToday ? theme.primary : theme.elevated }]}>
                    <Text style={[styles.dateBadgeText, { color: isToday ? theme.onPrimary : theme.text }]}>{shortDate(date)}</Text>
                  </View>
                  <AppText variant="subheading">{isToday ? "היום" : `יום ${dayName(date)}`}</AppText>
                  {isToday ? (
                    <AppText variant="caption" color="textMuted">
                      {dayName(date)}
                    </AppText>
                  ) : null}
                </Row>
                <Pressable
                  onPress={() => setSlot({ date, meal: defaultMealFor(date), course: "main" })}
                  style={[styles.addSmall, { backgroundColor: theme.primarySoft }]}
                  accessibilityLabel="הוספה ליום"
                >
                  <Ionicons name="add" size={18} color={theme.primary} />
                </Pressable>
              </Row>

              {mealsPresent.length === 0 ? (
                <AppText variant="caption" color="textMuted">
                  עוד לא תוכנן כלום
                </AppText>
              ) : null}

              {mealsPresent.map((m) => {
                const list = dayEntries
                  .filter((e) => e.meal === m.id)
                  .sort((a, b) => COURSE_ORDER[a.course] - COURSE_ORDER[b.course] || a.position - b.position);
                return (
                  <View key={m.id} style={{ gap: 6 }}>
                    <Row style={{ justifyContent: "space-between" }}>
                      <Row style={{ gap: 6 }}>
                        <Text style={{ fontSize: 15 }}>{m.emoji}</Text>
                        <AppText variant="label" color="textSecondary">
                          {m.label}
                        </AppText>
                      </Row>
                      <Pressable onPress={() => setSlot({ date, meal: m.id, course: "main" })} hitSlop={8}>
                        <AppText variant="caption" color="primary">
                          + מנה
                        </AppText>
                      </Pressable>
                    </Row>
                    {list.map((e) => {
                      const recipe = e.recipe_id ? recipeById.get(e.recipe_id) : undefined;
                      const image = recipe?.image_url ?? recipe?.thumbnail_url;
                      const minutes = recipe ? formatMinutes((recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)) : null;
                      return (
                        <Pressable
                          key={e.id}
                          onPress={() => setEntryMenu(e)}
                          style={({ pressed }) => [styles.entry, { backgroundColor: pressed ? theme.elevated : theme.background }]}
                        >
                          {image ? (
                            <Image source={{ uri: image }} style={styles.thumb} />
                          ) : (
                            <View style={[styles.thumb, { backgroundColor: theme.elevated, alignItems: "center", justifyContent: "center" }]}>
                              <Text style={{ fontSize: 18 }}>{courseOf(e.course).emoji}</Text>
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <AppText numberOfLines={1} style={e.cooked_at ? { color: theme.textMuted, textDecorationLine: "line-through" } : undefined}>
                              {titleOf(e)}
                            </AppText>
                            <AppText variant="caption" color="textMuted" numberOfLines={1}>
                              {[
                                courseOf(e.course).label,
                                e.servings ? `${formatQuantity(e.servings)} מנות` : null,
                                minutes,
                                e.note ? `📝 ${e.note}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </AppText>
                          </View>
                          <Pressable onPress={() => cooked.mutate({ entry: e, value: !e.cooked_at })} hitSlop={8} accessibilityLabel="סיימנו">
                            <View
                              style={[
                                styles.tick,
                                { borderColor: e.cooked_at ? theme.accent : theme.beige, backgroundColor: e.cooked_at ? theme.accent : "transparent" },
                              ]}
                            >
                              {e.cooked_at ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                            </View>
                          </Pressable>
                          <Ionicons name="ellipsis-vertical" size={16} color={theme.textMuted} />
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}

              {mealsPresent.length ? (
                <Row style={{ gap: 6, flexWrap: "wrap" }}>
                  {MEALS.filter((m) => !mealsPresent.includes(m)).map((m) => (
                    <Pressable key={m.id} onPress={() => setSlot({ date, meal: m.id, course: "main" })} style={[styles.mealChip, { borderColor: theme.border }]}>
                      <AppText variant="caption" color="textSecondary">
                        + {m.label}
                      </AppText>
                    </Pressable>
                  ))}
                </Row>
              ) : null}

              {tomorrowNotes.map((e) => (
                <Row key={`n-${e.id}`} style={{ gap: 6 }}>
                  <Ionicons name="alarm-outline" size={14} color={theme.warning} />
                  <AppText variant="caption" color="textSecondary" numberOfLines={2} style={{ flex: 1 }}>
                    מחר: {titleOf(e)} · {e.note}
                  </AppText>
                </Row>
              ))}
            </Card>
          );
        })}

        <Button
          title="המצרכים של השבוע לרשימת הקניות"
          icon="cart-outline"
          variant="secondary"
          loading={addShopping.isPending}
          onPress={() => toShopping(start, end, "השבוע הזה")}
        />
      </ScrollView>

      {/* Add to a slot */}
      <ActionSheet
        visible={slot !== null}
        onClose={() => setSlot(null)}
        title={slot ? `יום ${dayName(slot.date)} ${shortDate(slot.date)}` : undefined}
        actions={
          slot
            ? [
                { icon: "book-outline", label: "מהמתכונים שלי", run: () => setPicker(slot) },
                { icon: "sparkles-outline", label: "תציע לי", run: () => setSuggest(slot) },
                { icon: "create-outline", label: "לכתוב שורה (למשל: פיצה בחוץ)", run: () => addText(slot) },
                { icon: "link-outline", label: "ייבוא מקישור", run: () => importInto(slot) },
              ]
            : []
        }
      >
        {slot ? (
          <View style={{ gap: Spacing.sm, marginVertical: Spacing.xs }}>
            <Row style={{ gap: 6, flexWrap: "wrap" }}>
              {MEALS.map((m) => (
                <Chip key={m.id} label={m.label} emoji={m.emoji} selected={slot.meal === m.id} onPress={() => setSlot({ ...slot, meal: m.id })} />
              ))}
            </Row>
            <Row style={{ gap: 6, flexWrap: "wrap" }}>
              {COURSES.map((c) => (
                <Chip key={c.id} label={c.label} emoji={c.emoji} tone="accent" selected={slot.course === c.id} onPress={() => setSlot({ ...slot, course: c.id })} />
              ))}
            </Row>
          </View>
        ) : null}
      </ActionSheet>

      {/* Entry menu */}
      <ActionSheet
        visible={entryMenu !== null}
        onClose={() => setEntryMenu(null)}
        title={entryMenu ? titleOf(entryMenu) : undefined}
        subtitle={entryMenu ? `יום ${dayName(entryMenu.date)} ${shortDate(entryMenu.date)} · ${mealOf(entryMenu.meal).label}` : undefined}
        actions={entryMenu ? entryActions(entryMenu) : []}
      />

      {/* Change course */}
      <ActionSheet
        visible={courseMenu !== null}
        onClose={() => setCourseMenu(null)}
        title="סוג מנה"
        actions={
          courseMenu
            ? COURSES.map((c) => ({
                emoji: c.emoji,
                label: c.label + (courseMenu.course === c.id ? " ✓" : ""),
                run: () => update.mutate({ id: courseMenu.id, patch: { course: c.id } }),
              }))
            : []
        }
      />

      {/* Move a line to another day */}
      <ActionSheet visible={moveEntry !== null} onClose={() => setMoveEntry(null)} title={moveEntry ? titleOf(moveEntry) : undefined} subtitle="לאיזה יום ולאיזו ארוחה?">
        {moveEntry ? (
          <MoveBody
            entry={moveEntry}
            onDone={(date, meal) => {
              update.mutate({ id: moveEntry.id, patch: { date, meal } });
              setMoveEntry(null);
            }}
          />
        ) : null}
      </ActionSheet>

      {/* Week menu */}
      <ActionSheet
        visible={weekMenu}
        onClose={() => setWeekMenu(false)}
        title={weekLabel(start)}
        actions={[
          { icon: "cart-outline", label: "המצרכים של כל השבוע לרשימה", run: () => toShopping(start, end, "השבוע הזה") },
          { icon: "cart-outline", label: "המצרכים של 3 הימים הקרובים", run: () => toShopping(today, addDays(today, 2), "שלושת הימים הקרובים") },
          {
            icon: "copy-outline",
            label: weekEmpty ? "להעתיק את השבוע שעבר לכאן" : "להעתיק את השבוע שעבר (נוסף למה שיש)",
            run: async () => {
              const res = await copyWeek.mutateAsync({ from: addDays(start, -7), to: start });
              dialog.alert(res.copied ? `הועתקו ${res.copied} שורות` : "השבוע שעבר ריק");
            },
          },
          {
            icon: "trash-outline",
            label: "לנקות את השבוע",
            color: theme.danger,
            run: async () => {
              const ok = await dialog.confirm("למחוק את כל התכנון של השבוע הזה?", undefined, { confirmText: "מחיקה", destructive: true });
              if (ok) for (const e of entries ?? []) remove.mutate(e.id);
            },
          },
        ]}
      />

      {picker ? (
        <RecipePicker slot={picker} recipes={recipes ?? []} onPick={(r) => addRecipe(picker, r)} onClose={() => setPicker(null)} />
      ) : null}
      {suggest ? (
        <SuggestModal
          slot={suggest}
          recipeById={recipeById}
          onPick={(r) => addRecipe(suggest, r)}
          onIdea={(idea) => {
            add.mutate({ ...suggest, title: idea.title, note: idea.description });
            setSuggest(null);
          }}
          onClose={() => setSuggest(null)}
        />
      ) : null}
    </Screen>
  );
}

function MoveBody({ entry, onDone }: { entry: MealPlanRow; onDone: (date: string, meal: MealId) => void }) {
  const [date, setDate] = useState(entry.date);
  const [meal, setMeal] = useState<MealId>(entry.meal);
  return (
    <View style={{ gap: Spacing.sm, marginVertical: Spacing.sm }}>
      <DayMealPicker
        days={pickerDays(entry.date)}
        date={date}
        meal={meal}
        onChange={(d, m) => {
          setDate(d);
          setMeal(m);
        }}
      />
      <Button title="להזיז" icon="arrow-redo-outline" disabled={date === entry.date && meal === entry.meal} onPress={() => onDone(date, meal)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Recipe picker: search + course filter
// ---------------------------------------------------------------------------
function RecipePicker({ slot, recipes, onPick, onClose }: { slot: Slot; recipes: RecipeRow[]; onPick: (r: RecipeRow) => void; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState<CourseId | "all">(slot.course === "other" ? "all" : slot.course);
  const list = recipes.filter((r) => {
    if (course !== "all" && courseForCategory(r.category) !== course) return false;
    if (!search.trim()) return true;
    const hay = [r.title, ...r.tags, ...r.ingredients.map((i) => i.name)].join(" ");
    return hay.includes(search.trim());
  });
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom }]}>
        <Row style={{ justifyContent: "space-between", paddingHorizontal: Spacing.md }}>
          <AppText variant="heading">מהמתכונים שלי</AppText>
          <IconButton icon="close" onPress={onClose} accessibilityLabel="סגירה" />
        </Row>
        <View style={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="חיפוש לפי שם, מצרך או תגית"
            placeholderTextColor={theme.textMuted}
            style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip label="הכול" selected={course === "all"} onPress={() => setCourse("all")} />
            {COURSES.filter((c) => c.id !== "other").map((c) => (
              <Chip key={c.id} label={c.label} emoji={c.emoji} selected={course === c.id} onPress={() => setCourse(c.id)} />
            ))}
          </ScrollView>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: 8 }}>
          {list.length === 0 ? (
            <AppText color="textMuted" style={{ textAlign: "center", marginTop: Spacing.lg }}>
              אין מתכון שמתאים. אפשר לכתוב שורה חופשית או לייבא.
            </AppText>
          ) : null}
          {list.map((r) => {
            const image = r.image_url ?? r.thumbnail_url;
            return (
              <Pressable key={r.id} onPress={() => onPick(r)} style={({ pressed }) => [styles.pickRow, Shadows.card, { backgroundColor: pressed ? theme.elevated : theme.card, borderColor: theme.border }]}>
                {image ? <Image source={{ uri: image }} style={styles.thumbLg} /> : <View style={[styles.thumbLg, { backgroundColor: theme.elevated }]} />}
                <View style={{ flex: 1 }}>
                  <AppText numberOfLines={1}>{r.title}</AppText>
                  <AppText variant="caption" color="textMuted" numberOfLines={1}>
                    {[r.category, formatMinutes((r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)), r.kids_approved ? "הילדים אהבו 👍" : null].filter(Boolean).join(" · ")}
                  </AppText>
                </View>
                <Ionicons name="add-circle" size={24} color={theme.primary} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// "תציע לי"
// ---------------------------------------------------------------------------
function SuggestModal({
  slot,
  recipeById,
  onPick,
  onIdea,
  onClose,
}: {
  slot: Slot;
  recipeById: Map<string, RecipeRow>;
  onPick: (r: RecipeRow) => void;
  onIdea: (idea: { title: string; description: string }) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<PlanSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.suggestPlan({ ...slot, hint: hint.trim() || null }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom }]}>
        <Row style={{ justifyContent: "space-between", paddingHorizontal: Spacing.md }}>
          <View>
            <AppText variant="heading">תציע לי</AppText>
            <AppText variant="caption" color="textSecondary">
              יום {dayName(slot.date)} · {mealOf(slot.meal).label} · {courseOf(slot.course).label}
            </AppText>
          </View>
          <IconButton icon="close" onPress={onClose} accessibilityLabel="סגירה" />
        </Row>
        <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md }}>
          <View style={{ gap: Spacing.sm }}>
            <TextInput
              value={hint}
              onChangeText={setHint}
              placeholder="רמז (לא חובה): משהו מהיר, בלי בשר, לאורחים..."
              placeholderTextColor={theme.textMuted}
              style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
              onSubmitEditing={ask}
            />
            <Button title={result ? "להציע שוב" : "מה כדאי?"} icon="sparkles-outline" loading={busy} onPress={ask} />
            {error ? (
              <AppText variant="caption" color="danger">
                {error}
              </AppText>
            ) : null}
          </View>
          {result?.picks.map((p) => {
            const r = recipeById.get(p.recipe_id);
            if (!r) return null;
            const image = r.image_url ?? r.thumbnail_url;
            return (
              <Pressable key={p.recipe_id} onPress={() => onPick(r)} style={({ pressed }) => [styles.pickRow, Shadows.card, { backgroundColor: pressed ? theme.elevated : theme.card, borderColor: theme.border, alignItems: "flex-start" }]}>
                {image ? <Image source={{ uri: image }} style={styles.thumbLg} /> : <View style={[styles.thumbLg, { backgroundColor: theme.elevated }]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {r.title}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {p.reason}
                  </AppText>
                </View>
                <Ionicons name="add-circle" size={24} color={theme.primary} />
              </Pressable>
            );
          })}
          {result && result.picks.length === 0 ? (
            <AppText color="textMuted" style={{ textAlign: "center" }}>
              לא מצאתי מתאים בין המתכונים שלכם.
            </AppText>
          ) : null}
          {result?.new_idea ? (
            <Card style={{ padding: Spacing.md, gap: 6, backgroundColor: theme.accentSoft, borderColor: "transparent" }} flat>
              <AppText variant="caption" color="accent">
                רעיון חדש (אין עדיין בקורט)
              </AppText>
              <AppText variant="bodyBold">{result.new_idea.title}</AppText>
              <AppText color="textSecondary">{result.new_idea.description}</AppText>
              <Button title="להוסיף כשורה לתכנון" variant="secondary" size="sm" onPress={() => onIdea(result.new_idea!)} />
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 120 },
  nav: { borderWidth: 1, borderRadius: Radius.lg, paddingVertical: 6, paddingHorizontal: 4, justifyContent: "space-between" },
  day: { padding: Spacing.md, gap: Spacing.sm },
  dateBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  dateBadgeText: { fontSize: 13, fontFamily: Fonts.bold },
  addSmall: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  entry: { flexDirection: "row", alignItems: "center", gap: 10, padding: 6, borderRadius: Radius.sm },
  thumb: { width: 40, height: 40, borderRadius: 10 },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  thumbLg: { width: 56, height: 56, borderRadius: 12 },
  mealChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.pill, borderWidth: StyleSheet.hairlineWidth },
  modal: { flex: 1, maxWidth: 560, width: "100%", alignSelf: "center", gap: Spacing.sm },
  search: { height: 46, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: 16, fontSize: 15, fontFamily: Fonts.regular, textAlign: "right" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth },
});
