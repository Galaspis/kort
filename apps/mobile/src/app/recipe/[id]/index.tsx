import { Ionicons } from "@expo/vector-icons";
import { lessonById } from "@recipe/shared";
import type { Ingredient } from "@recipe/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  type IconName,
  Loading,
  Row,
  Screen,
} from "@/components/ui";
import {
  CATEGORY_EMOJI,
  Fonts,
  Radius,
  Shadows,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { goBack } from "@/lib/navigation";
import { api } from "@/lib/api";
import { dialog } from "@/lib/dialog";
import { formatMinutes, formatQuantity, scaleIngredient } from "@/lib/format";
import { itemEmoji } from "@/lib/ingredients";
import {
  ingredientsToShopping,
  keys,
  useAddShoppingItems,
  useDeleteRecipe,
  useRecipe,
  useRecipeWhy,
  useSaveRecipe,
} from "@/lib/queries";
import { recipeToText, shareText, shareToWhatsApp } from "@/lib/share";
import { useScreenOn } from "@/lib/screen-on";
import { embedUrl, PLATFORM_LABEL } from "@/lib/video";

type Tab = "steps" | "ingredients" | "notes";
const TABS: { key: Tab; label: string }[] = [
  { key: "steps", label: "הכנה" },
  { key: "ingredients", label: "מצרכים" },
  { key: "notes", label: "דירוג והערות" },
];

export default function RecipeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: recipe, isLoading } = useRecipe(id);
  const save = useSaveRecipe();
  const remove = useDeleteRecipe();
  const addToList = useAddShoppingItems();
  const why = useRecipeWhy(id!);
  const screen = useScreenOn();
  const nutrition = useMutation({
    mutationFn: () => api.nutrition(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.recipe(id!) });
      queryClient.invalidateQueries({ queryKey: keys.recipes });
    },
    onError: (e) => dialog.alert("לא הצליח", e.message),
  });
  const [tab, setTab] = useState<Tab>("ingredients");
  const [menuOpen, setMenuOpen] = useState(false);
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const baseServings = recipe?.servings ?? null;
  const currentServings = servings ?? baseServings;
  const factor =
    baseServings && currentServings ? currentServings / baseServings : 1;

  const groups = useMemo(() => {
    const map = new Map<string | null, { ing: Ingredient; index: number }[]>();
    recipe?.ingredients.forEach((ing, index) => {
      const key = ing.group ?? null;
      map.set(key, [
        ...(map.get(key) ?? []),
        { ing: scaleIngredient(ing, factor), index },
      ]);
    });
    return [...map.entries()];
  }, [recipe, factor]);

  if (isLoading || !recipe) {
    return (
      <Screen>
        {isLoading ? (
          <Loading />
        ) : (
          <EmptyState icon="help-circle-outline" title="המתכון לא נמצא" />
        )}
      </Screen>
    );
  }

  const image = recipe.image_url ?? recipe.thumbnail_url;
  const canEmbed = Boolean(
    embedUrl(recipe.video_url ?? recipe.source_url, recipe.source_platform),
  );
  const totalTime = formatMinutes(
    (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0),
  );
  const emoji = CATEGORY_EMOJI[recipe.category] ?? "🍽️";

  function patch(input: Parameters<typeof save.mutate>[0]["input"]) {
    save.mutate({ id: recipe!.id, input });
  }

  function addIngredientsToList() {
    const selected = recipe!.ingredients
      .map((ing, i) => ({ ing: scaleIngredient(ing, factor), i }))
      .filter(({ i }) => checked.size === 0 || checked.has(i))
      .map(({ ing }) => ing);
    addToList.mutate(
      ingredientsToShopping(selected, { id: recipe!.id, title: recipe!.title }),
      {
        onSuccess: async () => {
          setChecked(new Set());
          const go = await dialog.confirm(
            "נוסף לרשימת הקניות",
            `${selected.length} מצרכים. לעבור לרשימה?`,
            {
              confirmText: "לרשימה",
              cancelText: "סגור",
            },
          );
          if (go) router.navigate("/(tabs)/shopping");
        },
        onError: (e) => dialog.alert("לא הצליח", e.message),
      },
    );
  }

  async function confirmDelete() {
    const ok = await dialog.confirm(
      "למחוק את המתכון?",
      "אי אפשר לשחזר אחרי מחיקה.",
      { confirmText: "מחיקה", destructive: true },
    );
    if (ok) remove.mutate(recipe!.id, { onSuccess: () => goBack() });
  }

  function openSource() {
    if (recipe!.source_url) Linking.openURL(recipe!.source_url);
  }
  function openVideo() {
    if (canEmbed)
      router.push({
        pathname: "/recipe/[id]/video",
        params: { id: recipe!.id },
      });
    else openSource();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={[styles.hero, { backgroundColor: theme.elevated }]}>
          {image ? (
            <Image
              source={{ uri: image }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Text style={{ fontSize: 96 }}>{emoji}</Text>
            </View>
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.35)", "transparent"]}
            locations={[0, 0.5]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Row style={[styles.heroBar, { top: insets.top + Spacing.sm }]}>
            <IconButton
              icon="chevron-forward"
              circle
              onPress={() => goBack()}
            />
            <View style={{ flex: 1 }} />
            <IconButton
              icon={recipe.is_favorite ? "heart" : "heart-outline"}
              color={recipe.is_favorite ? "primary" : "text"}
              circle
              onPress={() => patch({ is_favorite: !recipe.is_favorite })}
            />
            <IconButton
              icon="ellipsis-horizontal"
              circle
              onPress={() => setMenuOpen(true)}
            />
          </Row>
          {recipe.video_url ? (
            <Pressable onPress={openVideo} style={styles.play}>
              <Ionicons
                name="play"
                size={30}
                color="#fff"
                style={{ marginStart: 3 }}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetHeader}>
            <AppText variant="title">{recipe.title}</AppText>
            {recipe.description ? (
              <AppText color="textSecondary">{recipe.description}</AppText>
            ) : null}
            <Row style={{ gap: Spacing.sm, flexWrap: "wrap" }}>
              {recipe.rating ? (
                <Row style={{ gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Ionicons
                      key={n}
                      name={n <= recipe.rating! ? "star" : "star-outline"}
                      size={14}
                      color={theme.warning}
                    />
                  ))}
                </Row>
              ) : null}
              {recipe.kids_approved === true ? (
                <Chip label="הילדים אהבו" emoji="👍" tone="accent" />
              ) : null}
              {recipe.kids_approved === false ? (
                <Chip label="הילדים פחות" emoji="👎" />
              ) : null}
            </Row>
            <Row style={styles.metaRow}>
              <Meta icon="time-outline" text={totalTime ?? "—"} />
              <View
                style={[styles.metaDivider, { backgroundColor: theme.border }]}
              />
              <Meta icon="speedometer-outline" text={recipe.difficulty} />
              <View
                style={[styles.metaDivider, { backgroundColor: theme.border }]}
              />
              <Meta
                icon="people-outline"
                text={
                  baseServings ? `${formatQuantity(baseServings)} מנות` : "—"
                }
              />
            </Row>
          </View>

          <Row style={[styles.tabs, { borderBottomColor: theme.border }]}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={styles.tab}
                >
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color: active ? theme.primary : theme.textSecondary,
                        fontFamily: active ? Fonts.bold : Fonts.medium,
                      },
                    ]}
                  >
                    {t.label}
                  </Text>
                  <View
                    style={[
                      styles.tabIndicator,
                      {
                        backgroundColor: active ? theme.primary : "transparent",
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </Row>

          <View style={styles.tabBody}>
            {tab === "ingredients" ? (
              <View style={{ gap: Spacing.sm }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <AppText variant="heading">מצרכים</AppText>
                  {baseServings ? (
                    <Row
                      style={[
                        styles.servings,
                        {
                          borderColor: theme.border,
                          backgroundColor: theme.card,
                        },
                      ]}
                    >
                      <IconButton
                        icon="remove"
                        size={18}
                        onPress={() =>
                          setServings(Math.max(1, (currentServings ?? 1) - 1))
                        }
                      />
                      <AppText variant="label">
                        {formatQuantity(currentServings)} מנות
                      </AppText>
                      <IconButton
                        icon="add"
                        size={18}
                        onPress={() => setServings((currentServings ?? 1) + 1)}
                      />
                    </Row>
                  ) : null}
                </Row>
                {groups.map(([group, items], gi) => (
                  <View key={group ?? gi}>
                    {group ? (
                      <AppText
                        variant="label"
                        color="primary"
                        style={{ paddingTop: Spacing.sm, paddingBottom: 4 }}
                      >
                        {group}
                      </AppText>
                    ) : null}
                    {items.map(({ ing, index }) => {
                      const on = checked.has(index);
                      const qty = [formatQuantity(ing.quantity), ing.unit]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <Pressable
                          key={index}
                          onPress={() =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })
                          }
                          style={[
                            styles.ingredient,
                            { borderBottomColor: theme.border },
                          ]}
                        >
                          <View
                            style={[
                              styles.check,
                              {
                                borderColor: on ? theme.primary : theme.beige,
                                backgroundColor: on
                                  ? theme.primary
                                  : "transparent",
                              },
                            ]}
                          >
                            {on ? (
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color="#fff"
                              />
                            ) : null}
                          </View>
                          <View
                            style={[
                              styles.thumb,
                              { backgroundColor: theme.elevated },
                            ]}
                          >
                            <Text style={{ fontSize: 20 }}>
                              {itemEmoji(ing.name, ing.aisle)}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <AppText>
                              {qty ? (
                                <AppText variant="bodyBold">{qty} </AppText>
                              ) : null}
                              {ing.name}
                            </AppText>
                            {ing.note ? (
                              <AppText variant="caption" color="textMuted">
                                {ing.note}
                              </AppText>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                <Button
                  title={
                    checked.size
                      ? `הוספת ${checked.size} לרשימת הקניות`
                      : "הוספת הכול לרשימת הקניות"
                  }
                  icon="cart-outline"
                  variant="secondary"
                  loading={addToList.isPending}
                  onPress={addIngredientsToList}
                  style={{ marginTop: Spacing.sm }}
                />

                <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <AppText variant="heading">ערכים תזונתיים</AppText>
                    <AppText variant="caption" color="textMuted">
                      למנה אחת · הערכה
                    </AppText>
                  </Row>
                  {recipe.nutrition ? (
                    <Row style={{ gap: Spacing.sm }}>
                      <NutritionTile
                        value={recipe.nutrition.calories}
                        unit=""
                        label="קלוריות"
                      />
                      <NutritionTile
                        value={recipe.nutrition.protein_g}
                        unit="ג׳"
                        label="חלבון"
                      />
                      <NutritionTile
                        value={recipe.nutrition.carbs_g}
                        unit="ג׳"
                        label="פחמימות"
                      />
                      <NutritionTile
                        value={recipe.nutrition.fat_g}
                        unit="ג׳"
                        label="שומן"
                      />
                    </Row>
                  ) : (
                    <Button
                      title="חישוב ערכים תזונתיים"
                      icon="flask-outline"
                      variant="outline"
                      loading={nutrition.isPending}
                      onPress={() => nutrition.mutate()}
                    />
                  )}
                </View>
              </View>
            ) : null}

            {tab === "steps" ? (
              <View style={{ gap: Spacing.sm }}>
                <AppText variant="heading">אופן ההכנה</AppText>
                {recipe.steps.map((step, i) => {
                  const last = i === recipe.steps.length - 1;
                  return (
                    <Row
                      key={i}
                      style={{ alignItems: "stretch", gap: Spacing.sm + 4 }}
                    >
                      <View style={{ alignItems: "center", width: 32 }}>
                        <View
                          style={[
                            styles.stepNumber,
                            { backgroundColor: theme.primary },
                          ]}
                        >
                          <Text
                            style={[
                              styles.stepNumberText,
                              { color: theme.onPrimary },
                            ]}
                          >
                            {i + 1}
                          </Text>
                        </View>
                        {!last ? (
                          <View
                            style={[
                              styles.stepLine,
                              { backgroundColor: theme.border },
                            ]}
                          />
                        ) : null}
                      </View>
                      <View
                        style={{
                          flex: 1,
                          paddingBottom: last ? 0 : Spacing.md,
                          gap: 4,
                        }}
                      >
                        {step.group &&
                        (i === 0 ||
                          recipe.steps[i - 1]?.group !== step.group) ? (
                          <AppText variant="caption" color="primary">
                            {step.group}
                          </AppText>
                        ) : null}
                        <AppText style={{ paddingTop: 4 }}>{step.text}</AppText>
                        {step.duration_seconds ? (
                          <Row style={{ gap: 4 }}>
                            <Ionicons
                              name="timer-outline"
                              size={14}
                              color={theme.accent}
                            />
                            <AppText variant="caption" color="accent">
                              {formatMinutes(
                                Math.round(step.duration_seconds / 60),
                              ) ?? `${step.duration_seconds} שנ׳`}
                            </AppText>
                          </Row>
                        ) : null}
                      </View>
                    </Row>
                  );
                })}

                <View style={{ gap: Spacing.sm, marginTop: Spacing.md }}>
                  <AppText variant="heading">למה זה עובד?</AppText>
                  {recipe.why?.length ? (
                    <Card style={{ padding: Spacing.md, gap: Spacing.sm + 4 }}>
                      {recipe.why.map((note, i) => {
                        const lesson = note.lesson_id ? lessonById(note.lesson_id) : undefined;
                        return (
                          <View key={i} style={{ gap: 4 }}>
                            <Row style={{ gap: Spacing.sm, alignItems: "flex-start" }}>
                              <Text style={{ fontSize: 16, lineHeight: 24 }}>{lesson?.emoji ?? "💡"}</Text>
                              <AppText style={{ flex: 1 }}>{note.text}</AppText>
                            </Row>
                            {lesson ? (
                              <Pressable
                                onPress={() => router.push({ pathname: "/learn/[id]", params: { id: lesson.id } })}
                                style={{ alignSelf: "flex-start", marginStart: 28 }}
                              >
                                <AppText variant="caption" color="primary">
                                  שיעור {lesson.number}: {lesson.title} ←
                                </AppText>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                      <Pressable onPress={() => why.mutate(true)} disabled={why.isPending} style={{ alignSelf: "flex-end" }}>
                        <AppText variant="caption" color="textMuted">
                          {why.isPending ? "כותב מחדש..." : "לכתוב מחדש"}
                        </AppText>
                      </Pressable>
                    </Card>
                  ) : (
                    <Card flat style={{ padding: Spacing.md, gap: Spacing.sm }}>
                      <AppText color="textSecondary">
                        שלוש-חמש הערות על המדע שמאחורי המתכון הזה: מתי המלח, למה ההשחמה, מה עושה הלימון בסוף.
                      </AppText>
                      <Button
                        title="למה זה עובד?"
                        icon="sparkles-outline"
                        variant="secondary"
                        size="sm"
                        loading={why.isPending}
                        onPress={() => why.mutate(false)}
                      />
                      {why.isError ? (
                        <AppText variant="caption" color="danger">
                          {(why.error as Error).message}
                        </AppText>
                      ) : null}
                    </Card>
                  )}
                </View>
              </View>
            ) : null}

            {tab === "notes" ? (
              <View style={{ gap: Spacing.lg }}>
                <View style={{ gap: Spacing.sm }}>
                  <AppText variant="heading">איך יצא?</AppText>
                  <Card style={{ padding: Spacing.md, gap: Spacing.md }}>
                    <Row style={{ justifyContent: "space-between" }}>
                      <AppText variant="label">הדירוג שלנו</AppText>
                      <Row style={{ gap: 4 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Pressable
                            key={n}
                            onPress={() =>
                              patch({ rating: recipe.rating === n ? null : n })
                            }
                            hitSlop={4}
                          >
                            <Ionicons
                              name={
                                recipe.rating && n <= recipe.rating
                                  ? "star"
                                  : "star-outline"
                              }
                              size={28}
                              color={theme.warning}
                            />
                          </Pressable>
                        ))}
                      </Row>
                    </Row>
                    <Row style={{ justifyContent: "space-between" }}>
                      <AppText variant="label">הילדים אהבו?</AppText>
                      <Row style={{ gap: Spacing.sm }}>
                        <Chip
                          label="כן!"
                          emoji="👍"
                          tone="accent"
                          selected={recipe.kids_approved === true}
                          onPress={() =>
                            patch({
                              kids_approved:
                                recipe.kids_approved === true ? null : true,
                            })
                          }
                        />
                        <Chip
                          label="לא"
                          emoji="👎"
                          selected={recipe.kids_approved === false}
                          onPress={() =>
                            patch({
                              kids_approved:
                                recipe.kids_approved === false ? null : false,
                            })
                          }
                        />
                      </Row>
                    </Row>
                    <AppText variant="caption" color="textMuted">
                      {recipe.times_cooked > 0
                        ? `בישלתם את זה ${recipe.times_cooked === 1 ? "פעם אחת" : `${recipe.times_cooked} פעמים`} 🙌`
                        : "עדיין לא בישלתם את זה"}
                    </AppText>
                  </Card>
                </View>

                <View style={{ gap: Spacing.sm }}>
                  <AppText variant="heading">הערות שלי</AppText>
                  {recipe.notes ? (
                    <Card style={{ padding: Spacing.md }}>
                      <AppText>{recipe.notes}</AppText>
                    </Card>
                  ) : (
                    <AppText color="textMuted">
                      אין הערות עדיין. אפשר להוסיף דרך העריכה (העיפרון למעלה).
                    </AppText>
                  )}
                </View>

                {recipe.source_url ? (
                  <Pressable
                    onPress={recipe.video_url ? openVideo : openSource}
                  >
                    <Card style={styles.sourceCard}>
                      <View
                        style={[
                          styles.sourceIcon,
                          { backgroundColor: theme.primarySoft },
                        ]}
                      >
                        <Ionicons
                          name={recipe.video_url ? "play" : "link-outline"}
                          size={20}
                          color={theme.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText variant="label">
                          {recipe.video_url
                            ? "לצפייה בסרטון המקורי"
                            : "למקור המתכון"}
                        </AppText>
                        <AppText
                          variant="caption"
                          color="textMuted"
                          numberOfLines={1}
                        >
                          {[
                            PLATFORM_LABEL[recipe.source_platform],
                            recipe.author,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </AppText>
                      </View>
                      <Ionicons
                        name="chevron-back"
                        size={18}
                        color={theme.textMuted}
                      />
                    </Card>
                  </Pressable>
                ) : null}

                {recipe.warnings.length ? (
                  <Card
                    flat
                    style={[
                      styles.warnCard,
                      {
                        backgroundColor: theme.warningSoft,
                        borderColor: theme.warningSoft,
                      },
                    ]}
                  >
                    <Ionicons
                      name="information-circle"
                      size={20}
                      color={theme.warning}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      {recipe.warnings.map((w, i) => (
                        <AppText key={i} variant="caption">
                          {w}
                        </AppText>
                      ))}
                    </View>
                  </Card>
                ) : null}

                {recipe.tags.length ? (
                  <Row style={{ gap: Spacing.xs, flexWrap: "wrap" }}>
                    {recipe.tags.map((t) => (
                      <Chip key={t} label={`#${t}`} tone="accent" />
                    ))}
                  </Row>
                ) : null}

                <Button
                  title="מחיקת המתכון"
                  icon="trash-outline"
                  variant="ghost"
                  size="sm"
                  onPress={confirmDelete}
                />
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={[styles.sheetBackdrop, { backgroundColor: theme.overlay }]}
          onPress={() => setMenuOpen(false)}
        >
          <Pressable
            style={[
              styles.menuSheet,
              {
                backgroundColor: theme.card,
                paddingBottom: insets.bottom + Spacing.lg,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <AppText
              variant="subheading"
              numberOfLines={1}
              style={{ textAlign: "center" }}
            >
              {recipe.title}
            </AppText>
            {(
              [
                {
                  icon: "logo-whatsapp",
                  label: "שליחה בוואטסאפ",
                  color: "#25D366",
                  run: () => shareToWhatsApp(recipeToText(recipe)),
                },
                {
                  icon: "share-outline",
                  label: "שיתוף אחר",
                  run: () => shareText(recipeToText(recipe)),
                },
                {
                  icon: "cart-outline",
                  label: "הוספת המצרכים לרשימת הקניות",
                  run: addIngredientsToList,
                },
                {
                  icon: screen.on ? "sunny" : "sunny-outline",
                  label: screen.on ? "המסך נשאר דולק: פועל (לכבות)" : "המסך נשאר דולק: כבוי (להדליק)",
                  run: () => screen.setOn(!screen.on),
                },
                {
                  icon: "create-outline",
                  label: "עריכת המתכון",
                  run: () =>
                    router.push({
                      pathname: "/recipe/[id]/edit",
                      params: { id: recipe.id },
                    }),
                },
                {
                  icon: "trash-outline",
                  label: "מחיקת המתכון",
                  color: theme.danger,
                  run: confirmDelete,
                },
              ] as {
                icon: IconName;
                label: string;
                color?: string;
                run: () => void;
              }[]
            ).map((item) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  setMenuOpen(false);
                  setTimeout(item.run, 150);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? theme.elevated : "transparent" },
                ]}
              >
                <View
                  style={[
                    styles.menuIcon,
                    { backgroundColor: item.color ?? theme.elevated },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={item.color ? "#fff" : theme.text}
                  />
                </View>
                <AppText
                  variant="bodyBold"
                  style={
                    item.color === theme.danger
                      ? { color: theme.danger }
                      : undefined
                  }
                >
                  {item.label}
                </AppText>
              </Pressable>
            ))}
            <Button
              title="ביטול"
              variant="ghost"
              onPress={() => setMenuOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + Spacing.sm,
            backgroundColor: theme.background,
          },
        ]}
      >
        <Button
          title="התחלת בישול"
          icon="play"
          size="lg"
          style={{ flex: 1 }}
          disabled={recipe.steps.length === 0}
          onPress={() =>
            router.push({
              pathname: "/recipe/[id]/cook",
              params: {
                id: recipe.id,
                servings: String(currentServings ?? ""),
              },
            })
          }
        />
      </View>
    </Screen>
  );
}

function Meta({
  icon,
  text,
}: {
  icon: "time-outline" | "speedometer-outline" | "people-outline";
  text: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: 6, flex: 1, justifyContent: "center" }}>
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <AppText variant="label">{text}</AppText>
    </Row>
  );
}

function NutritionTile({
  value,
  unit,
  label,
}: {
  value: number;
  unit: string;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.nutriTile,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Text style={[styles.nutriValue, { color: theme.text }]}>
        {Math.round(value)}
        {unit ? (
          <Text style={{ fontSize: 12, color: theme.textMuted }}> {unit}</Text>
        ) : null}
      </Text>
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  menuSheet: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: 4,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: Spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { height: 380 },
  heroPlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBar: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    gap: Spacing.sm,
  },
  play: {
    position: "absolute",
    alignSelf: "center",
    top: "42%",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(214,74,43,0.92)",
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.floating,
  },
  sheet: {
    marginTop: -Radius.lg,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingTop: Spacing.lg,
  },
  sheetHeader: { paddingHorizontal: Spacing.md, gap: Spacing.sm },
  metaRow: { marginTop: Spacing.xs, paddingVertical: Spacing.sm },
  metaDivider: { width: 1, height: 22 },
  tabs: {
    marginHorizontal: Spacing.md,
    borderBottomWidth: 1,
    marginTop: Spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", gap: 8, paddingTop: 6 },
  tabText: { fontSize: 16 },
  tabIndicator: {
    height: 3,
    width: "100%",
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  tabBody: { padding: Spacing.md, paddingTop: Spacing.lg },
  servings: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 4,
    gap: 2,
  },
  ingredient: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  nutriTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  nutriValue: { fontFamily: Fonts.black, fontSize: 18 },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontFamily: Fonts.bold, fontSize: 14 },
  stepLine: { width: 2, flex: 1, marginVertical: 4 },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    padding: Spacing.sm + 4,
  },
  sourceIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  warnCard: { flexDirection: "row", gap: Spacing.sm, padding: Spacing.sm + 4 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: Spacing.md,
  },
});
