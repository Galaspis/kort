import { Ionicons } from "@expo/vector-icons";
import { CATEGORIES } from "@recipe/shared";
import { Link } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/brand";
import { FeaturedCard, RecipeCard } from "@/components/recipe-card";
import {
  AppText,
  Button,
  Chip,
  EmptyState,
  IconButton,
  Loading,
  Row,
  Screen,
} from "@/components/ui";
import { CATEGORY_EMOJI, Fonts, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useInstallPrompt } from "@/lib/install";
import { useRecipes, useSaveRecipe } from "@/lib/queries";

/** "all" | "favorites" | "kids" | "cat:<category>" | "tag:<tag>" */
type Filter = string;

function filterLabel(filter: Filter): string | null {
  if (filter === "all") return null;
  if (filter === "favorites") return "מועדפים";
  if (filter === "kids") return "הילדים אהבו";
  if (filter.startsWith("cat:")) return filter.slice(4);
  if (filter.startsWith("tag:")) return `#${filter.slice(4)}`;
  return filter;
}

export default function RecipesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, isRefetching, error } = useRecipes();
  const save = useSaveRecipe();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const installer = useInstallPrompt();

  const recipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (filter === "favorites" && !r.is_favorite) return false;
      if (filter === "kids" && !r.kids_approved) return false;
      if (filter.startsWith("cat:") && r.category !== filter.slice(4))
        return false;
      if (filter.startsWith("tag:") && !r.tags.includes(filter.slice(4)))
        return false;
      if (!q) return true;
      const haystack = [
        r.title,
        r.description,
        r.cuisine,
        ...r.tags,
        ...r.ingredients.map((i) => i.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data, search, filter]);

  // The newest recipe gets the big card; everything else goes in the grid.
  const featured = recipes[0];
  const rest = recipes.slice(1);

  const usedCategories = useMemo(() => {
    const used = new Set((data ?? []).map((r) => r.category).filter(Boolean));
    const builtIn = CATEGORIES.filter((c) => used.has(c));
    const custom = [...used]
      .filter((c) => !(CATEGORIES as readonly string[]).includes(c))
      .sort((a, b) => a.localeCompare(b, "he"));
    return [...builtIn, ...custom];
  }, [data]);
  const usedTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of data ?? [])
      for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([t]) => t);
  }, [data]);

  function pick(next: Filter) {
    setFilter(next);
    setFilterOpen(false);
  }

  const activeLabel = filterLabel(filter);

  return (
    <Screen>
      <FlatList
        data={rest}
        keyExtractor={(r) => r.id}
        numColumns={2}
        columnWrapperStyle={{ gap: Spacing.sm + 4 }}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + Spacing.sm },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={theme.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: Spacing.md, marginBottom: Spacing.md }}>
            <Row style={{ justifyContent: "center", paddingVertical: 12 }}>
              <Wordmark width={176} />
            </Row>

            <Row
              style={[
                styles.search,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Ionicons name="search" size={20} color={theme.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="חיפוש לפי שם, מצרך או תגית..."
                placeholderTextColor={theme.textMuted}
                style={[styles.searchInput, { color: theme.text }]}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {search ? (
                <IconButton
                  icon="close-circle"
                  color="textMuted"
                  size={18}
                  onPress={() => setSearch("")}
                />
              ) : null}
              <Pressable
                onPress={() => setFilterOpen(true)}
                accessibilityLabel="סינון"
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: activeLabel
                      ? theme.primary
                      : theme.elevated,
                  },
                ]}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={activeLabel ? theme.onPrimary : theme.text}
                />
              </Pressable>
            </Row>

            {installer.canInstall && !installer.installed ? (
              <Pressable
                onPress={() => installer.install()}
                style={[
                  styles.installBanner,
                  { backgroundColor: theme.accentSoft },
                ]}
              >
                <Ionicons
                  name="download-outline"
                  size={20}
                  color={theme.accent}
                />
                <AppText variant="label" style={{ flex: 1 }}>
                  התקינו את קורט במסך הבית כדי לשתף אליו ישירות מפייסבוק
                </AppText>
                <AppText variant="label" color="accent">
                  התקנה
                </AppText>
              </Pressable>
            ) : null}
            {activeLabel ? (
              <Row style={{ gap: Spacing.sm }}>
                <AppText variant="caption" color="textMuted">
                  מסונן לפי
                </AppText>
                <Chip
                  label={activeLabel}
                  icon="close"
                  selected
                  onPress={() => setFilter("all")}
                />
                <AppText variant="caption" color="textMuted">
                  {recipes.length} מתכונים
                </AppText>
              </Row>
            ) : null}

            {featured ? (
              <FeaturedCard
                recipe={featured}
                onToggleFavorite={() =>
                  save.mutate({
                    id: featured.id,
                    input: { is_favorite: !featured.is_favorite },
                  })
                }
              />
            ) : null}

            {rest.length ? (
              <Row
                style={{
                  justifyContent: "space-between",
                  marginTop: Spacing.xs,
                }}
              >
                <AppText variant="heading">מתכונים נבחרים</AppText>
                <AppText variant="caption" color="textMuted">
                  {data?.length ?? 0} מתכונים
                </AppText>
              </Row>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <RecipeCard recipe={item} />}
        ItemSeparatorComponent={() => (
          <View style={{ height: Spacing.sm + 4 }} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <Loading />
          ) : error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="לא הצלחנו לטעון"
              subtitle={(error as Error).message}
            >
              <Button
                title="נסו שוב"
                variant="secondary"
                onPress={() => refetch()}
              />
            </EmptyState>
          ) : data?.length && !featured ? (
            <EmptyState
              emoji="🔍"
              title="לא נמצא כלום"
              subtitle="נסו מילה אחרת או נקו את הסינון"
            >
              {activeLabel ? (
                <Button
                  title="ניקוי הסינון"
                  variant="secondary"
                  onPress={() => setFilter("all")}
                />
              ) : null}
            </EmptyState>
          ) : !data?.length ? (
            <EmptyState
              emoji="🍳"
              title="עדיין אין מתכונים"
              subtitle="שתפו רילס מאינסטגרם או פוסט מפייסבוק לקורט, או כתבו מתכון בעצמכם"
            >
              <Row style={{ gap: Spacing.sm, marginTop: Spacing.sm }}>
                <Link href="/import" asChild>
                  <Button title="ייבוא מקישור" icon="link-outline" />
                </Link>
                <Link href="/recipe/new" asChild>
                  <Button
                    title="כתיבה"
                    icon="create-outline"
                    variant="secondary"
                  />
                </Link>
              </Row>
            </EmptyState>
          ) : null
        }
      />

      {/* Filter sheet */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable
          style={[styles.sheetBackdrop, { backgroundColor: theme.overlay }]}
          onPress={() => setFilterOpen(false)}
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <Row style={{ justifyContent: "space-between" }}>
              <AppText variant="heading">סינון</AppText>
              {activeLabel ? (
                <Button
                  title="ניקוי"
                  variant="ghost"
                  size="sm"
                  onPress={() => pick("all")}
                />
              ) : null}
            </Row>
            <ScrollView
              style={{ maxHeight: 460 }}
              contentContainerStyle={{ gap: Spacing.md }}
            >
              <View style={{ gap: Spacing.sm }}>
                <AppText variant="label" color="textSecondary">
                  מהיר
                </AppText>
                <Row style={{ gap: Spacing.sm, flexWrap: "wrap" }}>
                  <Chip
                    label="הכול"
                    selected={filter === "all"}
                    onPress={() => pick("all")}
                  />
                  <Chip
                    label="מועדפים"
                    icon="heart"
                    selected={filter === "favorites"}
                    onPress={() => pick("favorites")}
                  />
                  <Chip
                    label="הילדים אהבו"
                    emoji="👍"
                    selected={filter === "kids"}
                    onPress={() => pick("kids")}
                  />
                </Row>
              </View>
              {usedCategories.length ? (
                <View style={{ gap: Spacing.sm }}>
                  <AppText variant="label" color="textSecondary">
                    קטגוריות
                  </AppText>
                  <Row style={{ gap: Spacing.sm, flexWrap: "wrap" }}>
                    {usedCategories.map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        emoji={CATEGORY_EMOJI[c]}
                        selected={filter === `cat:${c}`}
                        onPress={() => pick(`cat:${c}`)}
                      />
                    ))}
                  </Row>
                </View>
              ) : null}
              {usedTags.length ? (
                <View style={{ gap: Spacing.sm }}>
                  <AppText variant="label" color="textSecondary">
                    תגיות
                  </AppText>
                  <Row style={{ gap: Spacing.sm, flexWrap: "wrap" }}>
                    {usedTags.map((t) => (
                      <Chip
                        key={t}
                        label={`#${t}`}
                        tone="accent"
                        selected={filter === `tag:${t}`}
                        onPress={() => pick(`tag:${t}`)}
                      />
                    ))}
                  </Row>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  installBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 4,
    padding: Spacing.sm + 4,
    borderRadius: Radius.md,
  },
  list: { padding: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  search: {
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingStart: 16,
    paddingEnd: 6,
    height: 54,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Fonts.regular,
    textAlign: "right",
    writingDirection: "rtl",
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 4,
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
});
