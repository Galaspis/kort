/**
 * The meal planner's shared model: meals in a day, courses inside a meal, the
 * plan row, and date helpers (Israeli week: Sunday to Saturday).
 */
import type { Category } from "./index";

export const MEALS = [
  { id: "breakfast", label: "ארוחת בוקר", emoji: "🍳" },
  { id: "lunch", label: "צהריים", emoji: "🥗" },
  { id: "dinner", label: "ארוחת ערב", emoji: "🍽️" },
  { id: "friday", label: "ערב שישי", emoji: "🕯️" },
  { id: "shabbat", label: "שבת", emoji: "☀️" },
  { id: "batch", label: "בישול מראש", emoji: "🍲" },
] as const;
export type MealId = (typeof MEALS)[number]["id"];

export const COURSES = [
  { id: "salad", label: "סלט", emoji: "🥗" },
  { id: "starter", label: "מנה ראשונה", emoji: "🥣" },
  { id: "soup", label: "מרק", emoji: "🍲" },
  { id: "main", label: "עיקרית", emoji: "🍖" },
  { id: "side", label: "תוספת", emoji: "🍚" },
  { id: "bread", label: "לחם ומאפה", emoji: "🍞" },
  { id: "dessert", label: "קינוח", emoji: "🍰" },
  { id: "drink", label: "משקה", emoji: "🥤" },
  { id: "other", label: "אחר", emoji: "🍽️" },
] as const;
export type CourseId = (typeof COURSES)[number]["id"];

/** Order courses appear inside a meal: the way a table is served. */
export const COURSE_ORDER: Record<CourseId, number> = {
  bread: 0,
  salad: 1,
  starter: 2,
  soup: 3,
  main: 4,
  side: 5,
  dessert: 6,
  drink: 7,
  other: 8,
};

export function mealOf(id: string) {
  return MEALS.find((m) => m.id === id) ?? MEALS[2];
}
export function courseOf(id: string) {
  return COURSES.find((c) => c.id === id) ?? COURSES[8];
}

/** The course a recipe lands in by default, from its category. */
export function courseForCategory(category: Category | string): CourseId {
  switch (category) {
    case "סלטים":
      return "salad";
    case "מרקים":
      return "soup";
    case "תוספות":
    case "רטבים ומטבלים":
      return "side";
    case "מאפים ולחמים":
      return "bread";
    case "קינוחים":
      return "dessert";
    case "משקאות":
      return "drink";
    case "חטיפים":
      return "other";
    default:
      return "main";
  }
}

/** The meal a day usually plans first: Friday evening on Fridays, dinner otherwise. */
export function defaultMealFor(date: string): MealId {
  const day = new Date(date + "T12:00:00").getDay();
  return day === 5 ? "friday" : day === 6 ? "shabbat" : "dinner";
}

export interface MealPlanRow {
  id: string;
  household_id: string;
  /** YYYY-MM-DD */
  date: string;
  meal: MealId;
  course: CourseId;
  recipe_id: string | null;
  /** Free text when there is no recipe, or a label that overrides the recipe title. */
  title: string | null;
  servings: number | null;
  /** Shows on the entry and, as a reminder, on the day before ("להתחיל בצק"). */
  note: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Dates (local time, YYYY-MM-DD strings so phones and server agree)
// ---------------------------------------------------------------------------
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, n: number): string {
  const d = new Date(key + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** The Sunday that starts the week containing `key`. */
export function weekStart(key: string): string {
  const d = new Date(key + "T12:00:00");
  return addDays(key, -d.getDay());
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

export function dayName(key: string): string {
  return DAY_NAMES[new Date(key + "T12:00:00").getDay()]!;
}

/** "8.11" */
export function shortDate(key: string): string {
  const d = new Date(key + "T12:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

/** "8–14 בנובמבר" style label for a week */
export function weekLabel(start: string): string {
  const months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  const a = new Date(start + "T12:00:00");
  const b = new Date(addDays(start, 6) + "T12:00:00");
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ב${months[a.getMonth()]}`;
  return `${a.getDate()} ב${months[a.getMonth()]} – ${b.getDate()} ב${months[b.getMonth()]}`;
}
