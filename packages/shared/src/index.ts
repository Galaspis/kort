import { z } from "zod";
import { AISLES, type Aisle } from "./aisles";

/**
 * Shared recipe model used by the mobile app, the import server and the
 * Claude structured-output schema. Keep this file dependency-free apart from zod.
 */

export const CATEGORIES = [
  "ארוחת בוקר",
  "עוף",
  "בשר",
  "דגים",
  "פסטה",
  "מנה עיקרית",
  "תוספות",
  "סלטים",
  "מרקים",
  "מאפים ולחמים",
  "קינוחים",
  "חטיפים",
  "משקאות",
  "רטבים ומטבלים",
  "אחר",
] as const;
export type Category = (typeof CATEGORIES)[number];

export { AISLES, type Aisle } from "./aisles";
export * from "./grocery";
export * from "./scale";

export const DIFFICULTIES = ["קל", "בינוני", "מאתגר"] as const;

export const IngredientSchema = z.object({
  name: z.string().describe("שם המצרך בעברית, ללא כמות. לדוגמה: 'קמח', 'חזה עוף'"),
  quantity: z
    .number()
    .nullable()
    .describe("כמות מספרית. null אם אין כמות (למשל 'מלח לפי הטעם')"),
  unit: z
    .string()
    .nullable()
    .describe("יחידת מידה בעברית: 'כוס', 'כף', 'כפית', 'גרם', 'ק\"ג', 'מ\"ל', 'יחידה', או null"),
  note: z
    .string()
    .nullable()
    .describe("הערה קצרה: 'קצוץ דק', 'בטמפרטורת החדר', או null"),
  group: z
    .string()
    .nullable()
    .describe("קבוצת מצרכים כאשר המתכון מחולק לחלקים, למשל 'לבצק', 'לרוטב'. אחרת null"),
  aisle: z.enum(AISLES).describe("המחלקה בסופר שבה קונים את המצרך"),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const StepSchema = z.object({
  text: z.string().describe("הוראת הכנה אחת, ברורה וקצרה, בעברית"),
  duration_seconds: z
    .number()
    .nullable()
    .describe("אם השלב כולל זמן המתנה/בישול (למשל 'אופים 25 דקות'), הזמן בשניות. אחרת null"),
  group: z.string().nullable().describe("חלק במתכון אם רלוונטי, למשל 'הרוטב'. אחרת null"),
});
export type Step = z.infer<typeof StepSchema>;

export const NutritionSchema = z.object({
  calories: z.number().describe("קלוריות למנה אחת"),
  protein_g: z.number().describe("חלבון בגרם למנה"),
  carbs_g: z.number().describe("פחמימות בגרם למנה"),
  fat_g: z.number().describe("שומן בגרם למנה"),
});
export type Nutrition = z.infer<typeof NutritionSchema>;

export const RecipeContentSchema = z.object({
  title: z.string().describe("שם המתכון בעברית, קצר וברור"),
  description: z
    .string()
    .nullable()
    .describe("משפט או שניים שמתארים את המנה. null אם אין מידע"),
  servings: z.number().nullable().describe("מספר מנות. null אם לא ידוע"),
  prep_minutes: z.number().nullable().describe("זמן הכנה בדקות, null אם לא ידוע"),
  cook_minutes: z.number().nullable().describe("זמן בישול/אפייה בדקות, null אם לא ידוע"),
  category: z
    .string()
    .describe(
      `קטגוריה. בדרך כלל אחת מ: ${CATEGORIES.join(" | ")}. מנה עיקרית מעוף → 'עוף'; מבקר, טלה או בשר טחון → 'בשר'; מדגים ופירות ים → 'דגים'; פסטה, לזניה ואטריות → 'פסטה'; 'מנה עיקרית' רק לעיקריות אחרות (צמחוניות, קטניות, שקשוקה). משפחות יכולות להוסיף קטגוריות משלהן`,
    ),
  cuisine: z.string().nullable().describe("מטבח: 'איטלקי', 'אסייתי', 'ישראלי'... או null"),
  difficulty: z.enum(DIFFICULTIES),
  tags: z
    .array(z.string())
    .describe("עד 6 תגיות קצרות בעברית: 'טבעוני', 'ללא גלוטן', 'מהיר', 'לילדים', 'חגים'..."),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  nutrition: NutritionSchema.nullable().describe(
    "הערכה תזונתית למנה אחת לפי המצרכים והכמויות. null רק אם אין כמויות בכלל",
  ),
  original_language: z
    .string()
    .nullable()
    .describe("קוד שפת המקור של התוכן (he, en, ar, ru...) או null"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("עד כמה המתכון שלם ומדויק לפי המקור. low אם חסרים כמויות או שלבים"),
  warnings: z
    .array(z.string())
    .describe("הערות למשתמש בעברית על מה שלא היה ברור או הושלם בניחוש. ריק אם הכול ברור"),
});
export type RecipeContent = z.infer<typeof RecipeContentSchema>;

export type SourcePlatform = "instagram" | "facebook" | "tiktok" | "youtube" | "web" | "manual";

export interface RecipeSource {
  source_url: string | null;
  source_platform: SourcePlatform;
  video_url: string | null;
  thumbnail_url: string | null;
  author: string | null;
  caption: string | null;
}

/** Row shape of the `recipes` table (jsonb columns typed). */
/** One "why it works" note the model wrote for a recipe, tied to a course lesson when one fits. */
export interface WhyNote {
  text: string;
  lesson_id: string | null;
}

export interface RecipeRow extends RecipeContent, RecipeSource {
  id: string;
  /** Cached "למה זה עובד?" notes; null until asked for. */
  why: WhyNote[] | null;
  household_id: string;
  created_by: string | null;
  image_url: string | null;
  notes: string | null;
  rating: number | null;
  kids_approved: boolean | null;
  times_cooked: number;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export type ImportJobStatus = "queued" | "fetching" | "analyzing" | "done" | "failed";

export interface ImportJobRow {
  id: string;
  household_id: string;
  user_id: string;
  source_url: string | null;
  source_text: string | null;
  status: ImportJobStatus;
  progress: string | null;
  error: string | null;
  recipe_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShoppingItemRow {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  aisle: Aisle | null;
  checked: boolean;
  recipe_id: string | null;
  recipe_title: string | null;
  created_at: string;
  /** Which shopping trip the item belongs to (see ShoppingListRow). */
  list_id: string | null;
  /** Marked in the shop as "not available here"; it is copied to the next list. */
  unavailable: boolean;
  /** Picked by keyword or by the model when the item was added; null = decide on the client. */
  emoji: string | null;
}

export function detectPlatform(url: string | null | undefined): SourcePlatform {
  if (!url) return "manual";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("facebook.com") || host === "fb.watch" || host.includes("fb.com")) return "facebook";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    return "web";
  } catch {
    return "web";
  }
}

export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}

// ---------------------------------------------------------------------------
// Loose schema for what the model returns, plus normalization into the strict
// RecipeContent. Models occasionally invent a near-miss label ("ירקות" instead
// of "ירקות ופירות"); rejecting the whole recipe for that is a bad trade.
// ---------------------------------------------------------------------------
export const RecipeAISchema = RecipeContentSchema.extend({
  category: z
    .string()
    .describe(
      `אחת מהקטגוריות הבאות בדיוק: ${CATEGORIES.join(" | ")}. עיקרית מעוף → 'עוף'; מבקר/טלה/בשר טחון → 'בשר'; דגים ופירות ים → 'דגים'; פסטה/לזניה/אטריות → 'פסטה'; 'מנה עיקרית' רק לעיקריות אחרות`,
    ),
  difficulty: z.string().describe(`אחת מהאפשרויות בדיוק: ${DIFFICULTIES.join(" | ")}`),
  ingredients: z.array(
    IngredientSchema.extend({
      aisle: z.string().describe(`המחלקה בסופר שבה קונים את המצרך. אחת מהאפשרויות הבאות בדיוק: ${AISLES.join(" | ")}`),
    }),
  ),
});
export type RecipeAIOutput = z.infer<typeof RecipeAISchema>;

function clean(value: string): string {
  return value.replace(/["'\u05F3\u05F4.,:;!?()\[\]]/g, "").replace(/\s+/g, " ").trim();
}

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T, keywords: [RegExp, T][]): T {
  if (!value) return fallback;
  const exact = allowed.find((a) => a === value);
  if (exact) return exact;
  const c = clean(value);
  const loose = allowed.find((a) => clean(a) === c) ?? allowed.find((a) => c.includes(clean(a)) || clean(a).includes(c));
  if (loose) return loose;
  const byKeyword = keywords.find(([re]) => re.test(c));
  return byKeyword ? byKeyword[1] : fallback;
}

const AISLE_KEYWORDS: [RegExp, Aisle][] = [
  [/ירק|פיר|עשב|סלט|תפוח|בצל|שום|לימון/, "ירקות ופירות"],
  [/בשר|עוף|הודו|בקר|טלה|נקניק|קצב/, "בשר ועוף"],
  [/דג|סלמון|טונה|פירות ים/, "דגים"],
  [/חלב|גבינ|ביצ|יוגורט|שמנת|חמאה|מחלבה/, "מוצרי חלב וביצים"],
  [/מאפ|לחם|פית|בצק|חלה|עוג/, "מאפייה"],
  [/יבש|דגן|קמח|אורז|פסט|קטני|סוכר|שמן|אגוז|שקד|קורנפל|אפי/, "יבשים ודגנים"],
  [/שימור|רוטב|רטב|רסק|ממרח|חומץ|סויה|טחינה|חרדל|מיונז|קטשופ/, "שימורים ורטבים"],
  [/תבל|מלח|פלפל|פפריק|כמון|קינמון|וניל/, "תבלינים"],
  [/קפוא|קרח|גליד/, "קפואים"],
  [/משק|שתי|יין|מיץ|בירה|קפה|תה|סודה|מים/, "משקאות"],
  [/חטיף|מתוק|ממתק|שוקולד|סוכרי/, "חטיפים ומתוקים"],
  [/ניקוי|בית|נייר|סבון/, "בית וניקיון"],
];

const CATEGORY_KEYWORDS: [RegExp, Category][] = [
  [/בוקר|ברנץ/, "ארוחת בוקר"],
  [/עוף|הודו|פרגית|שניצל/, "עוף"],
  [/בשר|בקר|טלה|כבש|קבב|סטייק|צלי/, "בשר"],
  [/דג|סלמון|טונה|פירות ים/, "דגים"],
  [/פסט|ספגטי|לזני|נודלס|אטריות|ניוקי|רביולי/, "פסטה"],
  [/עיקרי|ערב|צהרי|תבשיל/, "מנה עיקרית"],
  [/תוספ|אורז|פירה|ירק/, "תוספות"],
  [/סלט/, "סלטים"],
  [/מרק/, "מרקים"],
  [/מאפ|לחם|פיצ|בצק/, "מאפים ולחמים"],
  [/קינוח|עוג|מתוק|שוקולד|גליד|קרם/, "קינוחים"],
  [/חטיף|נשנוש|ביניים/, "חטיפים"],
  [/משק|שתי|שייק|קוקטייל|מיץ/, "משקאות"],
  [/רוטב|רטב|מטבל|ממרח|טחינה/, "רטבים ומטבלים"],
];

const DIFFICULTY_KEYWORDS: [RegExp, (typeof DIFFICULTIES)[number]][] = [
  [/קל|פשוט|מהיר|easy/i, "קל"],
  [/קשה|מאתגר|מורכב|hard|advanced/i, "מאתגר"],
  [/בינוני|medium/i, "בינוני"],
];

// ---------------------------------------------------------------------------
// Finer main-course categories (added 2026-11-13). Recipes saved before then
// all sit in "מנה עיקרית"; this moves them to עוף / בשר / דגים / פסטה when the
// title or the ingredients make it obvious, and leaves everything else alone.
// ---------------------------------------------------------------------------
const MAIN_SIGNALS: { category: Category; title: RegExp; ingredient: RegExp }[] = [
  {
    category: "פסטה",
    title: /פסטה|ספגטי|לזניה|פטוצ'יני|פנה|נודלס|אטריות|ניוקי|רביולי|מקרוני|לינגוויני|טורטליני|רמן|פאד תאי|אורזו/,
    ingredient: /^(פסטה|ספגטי|לזניה|פטוצ'יני|פנה|נודלס|אטריות|ניוקי|רביולי|מקרוני|לינגוויני|טורטליני|פוזילי|ריגטוני|טליאטלה|אורזו)(\s|$)/,
  },
  {
    category: "דגים",
    // Hebrew letters are not \w, so whole words are matched by hand ("דג" but not "דגנים").
    title: /(^|[^֐-׿])דג(ים)?($|[^֐-׿])|סלמון|טונה|לברק|דניס|בורי|אמנון|מושט|שרימפס|קלמרי|פירות ים|בקלה|הרינג|מקרל|פורל|סרדינ/,
    ingredient: /^(דג|דגים|פילה דג|סלמון|טונה|לברק|דניס|בורי|אמנון|מושט|שרימפס|קלמרי|בקלה|הרינג|מקרל|פורל|סרדינים|פילה)(\s|$)|(^|[^֐-׿])דג($|[^֐-׿])|סלמון|טונה/,
  },
  {
    category: "עוף",
    title: /עוף|פרגית|פרגיות|שניצל|הודו|כרעיים|שוקיים|כנפיים|חזה/,
    ingredient: /עוף|פרגית|הודו|כרעיים|שוקיים|כנפיים|שניצל/,
  },
  {
    category: "בשר",
    title: /בשר|בקר|טלה|כבש|אנטריקוט|סטייק|צלי|אסאדו|קבב|קציצות|המבורגר|נקניק|צלעות|שייטל|אוסובוקו|כתף|פילה בקר|גולש|טחון/,
    ingredient: /בשר|בקר|טלה|כבש|אנטריקוט|סטייק|אסאדו|נקניק|צלעות|שייטל|אוסובוקו|טחון|המבורגר|קבב/,
  },
];

/**
 * A better category for a recipe that is filed under the generic "מנה עיקרית"
 * (or "אחר"). Title words win over ingredients; the first matching ingredient
 * decides otherwise ("קציצות עוף" with ground chicken → עוף). Returns the
 * current category when nothing is clear enough to change it.
 */
export function refineCategory(recipe: { title: string; category: string | null; ingredients: { name: string }[] }): string {
  const current = recipe.category || "אחר";
  if (current !== "מנה עיקרית" && current !== "אחר") return current;
  const byTitle = MAIN_SIGNALS.find((s) => s.title.test(recipe.title));
  if (byTitle) return byTitle.category;
  for (const ing of recipe.ingredients) {
    const hit = MAIN_SIGNALS.find((s) => s.ingredient.test(ing.name));
    if (hit) return hit.category;
  }
  return current;
}

export function normalizeRecipeContent(ai: RecipeAIOutput): RecipeContent {
  const category = pick(ai.category, CATEGORIES, "אחר", CATEGORY_KEYWORDS);
  return {
    ...ai,
    category: refineCategory({ title: ai.title, category, ingredients: ai.ingredients }),
    difficulty: pick(ai.difficulty, DIFFICULTIES, "בינוני", DIFFICULTY_KEYWORDS),
    tags: ai.tags.slice(0, 6),
    ingredients: ai.ingredients.map((ing) => ({
      ...ing,
      aisle: pick(ing.aisle, AISLES, "אחר", AISLE_KEYWORDS),
    })),
  };
}
export * from "./course";
export * from "./plan";
