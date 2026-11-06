import type { ImportJobRow, Nutrition, RecipeContent, RecipeRow, ShoppingItemRow, ShoppingListRow, ShoppingListSummary, WhyNote } from "@recipe/shared";

import { env } from "./env";

export const API_URL = env.apiUrl.replace(/\/$/, "");

/**
 * All data goes through the Kort server. Identity is the gallab login cookie, which the
 * browser sends by itself (same origin), so no token is attached here.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new UnauthorizedError();
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `שגיאת שרת (${res.status})`);
  return body;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("לא מחובר");
    this.name = "UnauthorizedError";
  }
}

export interface LessonProgress {
  lesson_id: string;
  completed_at: string;
  quiz_score: number | null;
}

export interface Me {
  id: string;
  email: string;
  display_name: string | null;
  household: { id: string; name: string } | null;
  members: { id: string; display_name: string | null }[];
  daily_lesson_email: boolean;
}

export const api = {
  me: () => request<Me>("/api/me"),
  updateMe: (patch: { display_name?: string; daily_lesson_email?: boolean }) =>
    request<{ ok: true }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }),
  version: () => request<{ version: number }>("/api/version"),

  recipes: () => request<RecipeRow[]>("/api/recipes"),
  recipe: (id: string) => request<RecipeRow>(`/api/recipes/${id}`),
  createRecipe: (input: Record<string, unknown>) => request<RecipeRow>("/api/recipes", { method: "POST", body: JSON.stringify(input) }),
  updateRecipe: (id: string, patch: Record<string, unknown>) =>
    request<RecipeRow>(`/api/recipes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRecipe: (id: string) => request<{ ok: true }>(`/api/recipes/${id}`, { method: "DELETE" }),

  shopping: (listId?: string | null) => request<ShoppingItemRow[]>(`/api/shopping${listId ? `?list=${encodeURIComponent(listId)}` : ""}`),
  addShopping: (items: unknown[]) => request<{ ok: true; list_id: string }>("/api/shopping", { method: "POST", body: JSON.stringify(items) }),
  setUnavailable: (id: string, value: boolean) =>
    request<ShoppingItemRow>(`/api/shopping/${id}/unavailable`, { method: "POST", body: JSON.stringify({ value }) }),
  shoppingLists: () => request<ShoppingListSummary[]>("/api/shopping/lists"),
  createShoppingList: (title?: string | null) =>
    request<ShoppingListRow>("/api/shopping/lists", { method: "POST", body: JSON.stringify({ title: title ?? null }) }),
  renameShoppingList: (id: string, title: string | null) =>
    request<ShoppingListRow>(`/api/shopping/lists/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteShoppingList: (id: string) => request<{ ok: true }>(`/api/shopping/lists/${id}`, { method: "DELETE" }),
  finishShoppingList: (id: string) => request<{ next: ShoppingListRow }>(`/api/shopping/lists/${id}/finish`, { method: "POST" }),
  updateShopping: (id: string, patch: Record<string, unknown>) =>
    request<ShoppingItemRow>(`/api/shopping/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteShopping: (ids: string[]) => request<{ ok: true }>("/api/shopping/delete", { method: "POST", body: JSON.stringify({ ids }) }),

  upload: async (bytes: ArrayBuffer, contentType: string) => {
    const res = await fetch(`${API_URL}/api/upload`, { method: "POST", credentials: "include", headers: { "content-type": contentType }, body: bytes });
    if (res.status === 401) throw new UnauthorizedError();
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "העלאת התמונה נכשלה");
    return body.url;
  },

  startImport: (input: { url?: string; text?: string }) =>
    request<ImportJobRow>("/api/import", { method: "POST", body: JSON.stringify(input) }),
  getImport: (id: string) => request<ImportJobRow>(`/api/import/${id}`),
  enrich: (draft: { title: string; description: string | null; servings: number | null; ingredientsText: string; stepsText: string }) =>
    request<RecipeContent>("/api/enrich", { method: "POST", body: JSON.stringify(draft) }),
  nutrition: (recipeId: string) => request<Nutrition>(`/api/recipes/${recipeId}/nutrition`, { method: "POST" }),
  fetchVideo: (recipeId: string) => request<{ video_url: string }>(`/api/recipes/${recipeId}/video`, { method: "POST" }),
  findImage: (recipeId: string) => request<{ image_url: string | null }>(`/api/recipes/${recipeId}/image`, { method: "POST" }),
  learnProgress: () => request<LessonProgress[]>("/api/learn/progress"),
  completeLesson: (lesson_id: string, quiz_score: number | null) =>
    request<{ ok: true }>("/api/learn/progress", { method: "POST", body: JSON.stringify({ lesson_id, quiz_score }) }),
  resetLearning: () => request<{ ok: true }>("/api/learn/progress", { method: "DELETE" }),
  recipeWhy: (recipeId: string, force = false) =>
    request<{ why: WhyNote[] }>(`/api/recipes/${recipeId}/why${force ? "?force=1" : ""}`, { method: "POST" }),
  health: async () => {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  },
};
