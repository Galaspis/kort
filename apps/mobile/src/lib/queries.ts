import type { Aisle, Ingredient, MealPlanRow, RecipeContent, RecipeRow, ShoppingItemRow, ShoppingListRow } from "@recipe/shared";
import { LESSONS } from "@recipe/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { api, type NewPlanEntry } from "./api";

export const keys = {
  recipes: ["recipes"] as const,
  recipe: (id: string) => ["recipes", id] as const,
  shopping: ["shopping"] as const,
  shoppingLists: ["shopping", "lists"] as const,
  shoppingItems: (listId: string | null) => ["shopping", "items", listId ?? "current"] as const,
  profile: ["profile"] as const,
  learn: ["learn"] as const,
  plan: ["plan"] as const,
  planWeek: (from: string, to: string) => ["plan", from, to] as const,
};

/**
 * Sync between family phones: the server keeps a change counter per household;
 * while the app is in the foreground we ask for it every few seconds and refresh
 * when it moved (someone else edited a recipe or the shopping list).
 */
export function useRealtimeSync(enabled: boolean) {
  const client = useQueryClient();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (Platform.OS === "web" && typeof document !== "undefined" && document.hidden) return;
      try {
        const { version } = await api.version();
        if (last.current !== null && version !== last.current) {
          client.invalidateQueries({ queryKey: keys.recipes });
          client.invalidateQueries({ queryKey: keys.shopping });
          client.invalidateQueries({ queryKey: keys.plan });
        }
        last.current = version;
      } catch {
        /* offline or logged out: try again next tick */
      }
    };
    const start = () => { if (!timer) { tick(); timer = setInterval(tick, 4000); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => { stop(); sub.remove(); };
  }, [enabled, client]);
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
export function useRecipes() {
  return useQuery({ queryKey: keys.recipes, queryFn: api.recipes });
}

export function useRecipe(id: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.recipe(id ?? ""),
    enabled: Boolean(id),
    initialData: () => client.getQueryData<RecipeRow[]>(keys.recipes)?.find((r) => r.id === id),
    queryFn: () => api.recipe(id!),
  });
}

export type RecipeInput = RecipeContent & Pick<RecipeRow, "image_url" | "notes" | "is_favorite" | "rating" | "kids_approved">;

export function useSaveRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: Partial<RecipeInput> }) =>
      id ? api.updateRecipe(id, input) : api.createRecipe(input),
    onSuccess: (row) => {
      client.setQueryData(keys.recipe(row.id), row);
      client.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}

export function useDeleteRecipe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRecipe(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.recipes }),
  });
}

export function useMarkCooked() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (recipe: RecipeRow) => api.updateRecipe(recipe.id, { times_cooked: recipe.times_cooked + 1 }),
    onSuccess: (_, recipe) => {
      client.invalidateQueries({ queryKey: keys.recipe(recipe.id) });
      client.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}

// ---------------------------------------------------------------------------
// Shopping lists and items. Every mutation invalidates the "shopping" prefix,
// which covers the lists and every list's items.
// ---------------------------------------------------------------------------
export function useShoppingLists() {
  return useQuery({ queryKey: keys.shoppingLists, queryFn: api.shoppingLists });
}

/** Items of one list; null = the list being shopped now. */
export function useShoppingItems(listId: string | null = null) {
  return useQuery({ queryKey: keys.shoppingItems(listId), queryFn: () => api.shopping(listId) });
}

export interface NewShoppingItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: Aisle | null;
  recipe_id?: string | null;
  recipe_title?: string | null;
  list_id?: string | null;
}

export function ingredientsToShopping(ingredients: Ingredient[], recipe?: { id: string; title: string }): NewShoppingItem[] {
  return ingredients.map((ing) => ({
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,
    aisle: ing.aisle,
    recipe_id: recipe?.id ?? null,
    recipe_title: recipe?.title ?? null,
  }));
}

/** Adds items; the server merges into an existing open item with the same name and unit. */
export function useAddShoppingItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (items: NewShoppingItem[]) => api.addShopping(items),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useToggleShoppingItem(listId: string | null = null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (item: ShoppingItemRow) => api.updateShopping(item.id, { checked: !item.checked }),
    onMutate: async (item) => {
      await client.cancelQueries({ queryKey: keys.shoppingItems(listId) });
      client.setQueryData<ShoppingItemRow[]>(keys.shoppingItems(listId), (old) =>
        old?.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

/** "לא היה בסופר": greys the item here and copies it to the next list (or undoes that). */
export function useSetUnavailable(listId: string | null = null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ item, value }: { item: ShoppingItemRow; value: boolean }) => api.setUnavailable(item.id, value),
    onMutate: async ({ item, value }) => {
      await client.cancelQueries({ queryKey: keys.shoppingItems(listId) });
      client.setQueryData<ShoppingItemRow[]>(keys.shoppingItems(listId), (old) =>
        old?.map((i) => (i.id === item.id ? { ...i, unavailable: value, checked: value ? false : i.checked } : i)),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useMoveShoppingItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, listId }: { id: string; listId: string }) =>
      api.updateShopping(id, { list_id: listId, checked: false, unavailable: false }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useDeleteShoppingItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteShopping(ids),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useCreateShoppingList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title?: string | null): Promise<ShoppingListRow> => api.createShoppingList(title),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useRenameShoppingList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) => api.renameShoppingList(id, title),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

export function useDeleteShoppingList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteShoppingList(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

/** Finishes a trip: bought + missing items stay as history, the rest rolls to the next list. */
export function useFinishShoppingList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.finishShoppingList(id),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shopping }),
  });
}

// ---------------------------------------------------------------------------
// Cooking course
// ---------------------------------------------------------------------------
export function useLearnProgress() {
  return useQuery({ queryKey: keys.learn, queryFn: api.learnProgress });
}

/** The first lesson not yet completed (course order), or null when all are done. */
export function useNextLesson() {
  const { data } = useLearnProgress();
  const done = new Set((data ?? []).map((p) => p.lesson_id));
  return { next: LESSONS.find((l) => !done.has(l.id)) ?? null, doneCount: done.size, loaded: data !== undefined };
}

export function useCompleteLesson() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, score }: { lessonId: string; score: number | null }) => api.completeLesson(lessonId, score),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.learn }),
  });
}

export function useResetLearning() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.resetLearning(),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.learn }),
  });
}

/** Asks the server for (or rewrites) a recipe's "why it works" notes and stores them on the cached recipe. */
export function useRecipeWhy(recipeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (force?: boolean) => api.recipeWhy(recipeId, force),
    onSuccess: ({ why }) => {
      client.setQueryData<RecipeRow>(keys.recipe(recipeId), (old) => (old ? { ...old, why } : old));
      client.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}

// ---------------------------------------------------------------------------
// Meal planner
// ---------------------------------------------------------------------------
export function usePlan(from: string, to: string) {
  return useQuery({ queryKey: keys.planWeek(from, to), queryFn: () => api.plan(from, to) });
}

export function useAddPlanEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (entry: NewPlanEntry) => api.addPlan(entry),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.plan }),
  });
}

export function useUpdatePlanEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NewPlanEntry> & { position?: number } }) => api.updatePlan(id, patch),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.plan }),
  });
}

export function useDeletePlanEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlan(id),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: keys.plan });
      client.setQueriesData<MealPlanRow[]>({ queryKey: keys.plan }, (old) => old?.filter((e) => e.id !== id));
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.plan }),
  });
}

/** The "סיימנו" tick (optimistic); the recipe's cooked counter follows on the server. */
export function useSetPlanCooked() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ entry, value }: { entry: MealPlanRow; value: boolean }) => api.setPlanCooked(entry.id, value),
    onMutate: async ({ entry, value }) => {
      await client.cancelQueries({ queryKey: keys.plan });
      client.setQueriesData<MealPlanRow[]>({ queryKey: keys.plan }, (old) =>
        old?.map((e) => (e.id === entry.id ? { ...e, cooked_at: value ? new Date().toISOString() : null } : e)),
      );
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: keys.plan });
      client.invalidateQueries({ queryKey: keys.recipes });
    },
  });
}

export function useCopyPlanWeek() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.copyPlanWeek(from, to),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.plan }),
  });
}

// ---------------------------------------------------------------------------
// Profile / household
// ---------------------------------------------------------------------------
export interface ProfileInfo {
  id: string;
  email: string;
  display_name: string | null;
  household: { id: string; name: string } | null;
  members: { id: string; display_name: string | null }[];
  daily_lesson_email: boolean;
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: (): Promise<ProfileInfo> => api.me() });
}

export function useUpdateDisplayName() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (display_name: string) => api.updateMe({ display_name }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.profile }),
  });
}

/** "שיעור יומי במייל" on/off (optimistic, so the switch moves at once). */
export function useDailyLessonEmail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => api.updateMe({ daily_lesson_email: on }),
    onMutate: async (on) => {
      await client.cancelQueries({ queryKey: keys.profile });
      client.setQueryData<ProfileInfo>(keys.profile, (old) => (old ? { ...old, daily_lesson_email: on } : old));
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.profile }),
  });
}

export async function uploadRecipeImage(localUri: string): Promise<string> {
  const res = await fetch(localUri);
  const bytes = await res.arrayBuffer();
  const ext = localUri.split(".").pop()?.toLowerCase() ?? "jpg";
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return api.upload(bytes, type);
}
