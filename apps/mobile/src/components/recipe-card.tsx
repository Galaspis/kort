import { Ionicons } from "@expo/vector-icons";
import type { RecipeRow } from "@recipe/shared";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppText, Row } from "@/components/ui";
import {
  CATEGORY_EMOJI,
  Fonts,
  Radius,
  Shadows,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatMinutes, formatQuantity } from "@/lib/format";

/** Small grid card: photo with the title and time over it. */
export function RecipeCard({ recipe }: { recipe: RecipeRow }) {
  const theme = useTheme();
  const image = recipe.image_url ?? recipe.thumbnail_url;
  const total = formatMinutes(
    (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0),
  );
  const emoji = CATEGORY_EMOJI[recipe.category] ?? "🍽️";

  return (
    <View
      style={[styles.card, Shadows.card, { backgroundColor: theme.elevated }]}
    >
      <Link
        href={{ pathname: "/recipe/[id]", params: { id: recipe.id } }}
        asChild
      >
        <Pressable
          style={({ pressed }) => [
            { flex: 1 },
            { transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          <View style={styles.imageWrap}>
            {image ? (
              <Image
                source={{ uri: image }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={250}
              />
            ) : (
              <View style={styles.placeholder}>
                <Text style={{ fontSize: 48 }}>{emoji}</Text>
              </View>
            )}
            <LinearGradient
              colors={[
                "transparent",
                "rgba(20,12,8,0.25)",
                "rgba(20,12,8,0.85)",
              ]}
              locations={[0.35, 0.6, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {recipe.is_favorite ? (
              <View style={styles.heart}>
                <Ionicons name="heart" size={18} color="#fff" />
              </View>
            ) : null}
            <View style={styles.overlay} pointerEvents="none">
              <AppText
                variant="bodyBold"
                numberOfLines={2}
                style={styles.title}
              >
                {recipe.title}
              </AppText>
              {total ? (
                <Row style={{ gap: 4 }}>
                  <Ionicons
                    name="time-outline"
                    size={13}
                    color="rgba(255,255,255,0.9)"
                  />
                  <Text style={styles.meta}>{total}</Text>
                </Row>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * Home-screen tile for a category: the photo of one of its recipes with the
 * category name and the count over it. Tapping shows that category's recipes.
 */
export function CategoryTile({
  category,
  count,
  image,
  onPress,
}: {
  category: string;
  count: number;
  image: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const emoji = CATEGORY_EMOJI[category] ?? "🍽️";
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${category}, ${count} מתכונים`}
      style={({ pressed }) => [
        styles.catTile,
        Shadows.card,
        { backgroundColor: theme.elevated, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={{ fontSize: 44 }}>{emoji}</Text>
        </View>
      )}
      <LinearGradient
        colors={["transparent", "rgba(20,12,8,0.3)", "rgba(20,12,8,0.88)"]}
        locations={[0.3, 0.6, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.overlay} pointerEvents="none">
        <AppText variant="bodyBold" numberOfLines={1} style={styles.title}>
          {emoji} {category}
        </AppText>
        <Text style={styles.meta}>{count === 1 ? "מתכון אחד" : `${count} מתכונים`}</Text>
      </View>
    </Pressable>
  );
}

/** Large featured card for the top of the home screen. */
export function FeaturedCard({
  recipe,
  onToggleFavorite,
}: {
  recipe: RecipeRow;
  onToggleFavorite?: () => void;
}) {
  const theme = useTheme();
  const image = recipe.image_url ?? recipe.thumbnail_url;
  const total = formatMinutes(
    (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0),
  );
  const emoji = CATEGORY_EMOJI[recipe.category] ?? "🍽️";

  return (
    <View
      style={[
        styles.featured,
        Shadows.card,
        { backgroundColor: theme.elevated },
      ]}
    >
      <Link
        href={{ pathname: "/recipe/[id]", params: { id: recipe.id } }}
        asChild
      >
        <Pressable style={{ flex: 1 }}>
          {image ? (
            <Image
              source={{ uri: image }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={250}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={{ fontSize: 96 }}>{emoji}</Text>
            </View>
          )}
          <LinearGradient
            colors={["rgba(20,12,8,0.15)", "transparent", "rgba(20,12,8,0.9)"]}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.featuredBody} pointerEvents="none">
            <AppText
              variant="title"
              style={[styles.title, { lineHeight: 34 }]}
              numberOfLines={2}
            >
              {recipe.title}
            </AppText>
            <View style={[styles.pill, { backgroundColor: theme.primary }]}>
              <Text style={styles.pillText}>{recipe.category}</Text>
            </View>
            <Row style={{ gap: Spacing.sm + 4, flexWrap: "wrap" }}>
              {total ? <FeaturedStat icon="time-outline" text={total} /> : null}
              <FeaturedStat
                icon="speedometer-outline"
                text={recipe.difficulty}
              />
              {recipe.servings ? (
                <FeaturedStat
                  icon="people-outline"
                  text={`${formatQuantity(recipe.servings)} מנות`}
                />
              ) : null}
            </Row>
          </View>
        </Pressable>
      </Link>
      {onToggleFavorite ? (
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={8}
          accessibilityLabel="מועדף"
          style={[styles.heartLarge, { backgroundColor: "rgba(20,12,8,0.35)" }]}
        >
          <Ionicons
            name={recipe.is_favorite ? "heart" : "heart-outline"}
            size={28}
            color="#fff"
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function FeaturedStat({
  icon,
  text,
}: {
  icon: "time-outline" | "speedometer-outline" | "people-outline";
  text: string;
}) {
  return (
    <Row style={{ gap: 5 }}>
      <Ionicons name={icon} size={15} color="rgba(255,255,255,0.92)" />
      <Text style={styles.meta}>{text}</Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    maxWidth: "50%",
    borderRadius: Radius.md + 2,
    overflow: "hidden",
  },
  imageWrap: { aspectRatio: 0.9, width: "100%" },
  catTile: {
    width: 150,
    aspectRatio: 1.05,
    borderRadius: Radius.md + 2,
    overflow: "hidden",
  },
  placeholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  heart: {
    position: "absolute",
    top: 10,
    start: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(20,12,8,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 4,
  },
  title: { color: "#fff" },
  meta: {
    color: "rgba(255,255,255,0.92)",
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  featured: {
    borderRadius: Radius.lg,
    overflow: "hidden",
    aspectRatio: 0.92,
    width: "100%",
  },
  featuredBody: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.md + 4,
    gap: Spacing.sm,
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  pillText: { color: "#fff", fontFamily: Fonts.bold, fontSize: 13 },
  heartLarge: {
    position: "absolute",
    top: 14,
    start: 14,
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
});
