import { formatQuantity, guessAisle, parseShoppingLine, scaleIngredientSmart, type Ingredient } from "@recipe/shared";

export { formatQuantity, scaleText } from "@recipe/shared";

/**
 * Multiplies an ingredient for another number of servings and rounds it to an
 * amount you can measure (see packages/shared/src/scale.ts): 3 כפיות → 1 כף,
 * 1500 גרם → 1½ ק"ג, 4.5 ביצים → 5 ביצים. A factor of 1 leaves it untouched.
 */
export function scaleIngredient(ing: Ingredient, factor: number): Ingredient {
  if (ing.quantity === null || factor === 1) return ing;
  return scaleIngredientSmart(ing, factor);
}

export function ingredientLine(ing: Ingredient): string {
  const qty = formatQuantity(ing.quantity);
  const parts = [qty, ing.unit, ing.name].filter(Boolean);
  const main = parts.join(" ");
  return ing.note ? `${main} (${ing.note})` : main;
}

export function formatMinutes(min: number | null | undefined): string | null {
  if (!min) return null;
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ש׳ ${m} דק׳` : `${h} ש׳`;
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Fallback when the AI did not fill duration_seconds: "20 דקות", "חצי שעה", "45 שניות". */
export function parseDurationFromText(text: string): number | null {
  const t = text.replace(/[׳״'"]/g, "");
  const hours = t.match(/(\d+(?:[.,]\d+)?)\s*שע/);
  const minutes = t.match(/(\d+(?:[.,]\d+)?)\s*דק/);
  const seconds = t.match(/(\d+)\s*שנ/);
  if (/חצי שעה/.test(t)) return 30 * 60;
  if (/רבע שעה/.test(t)) return 15 * 60;
  let total = 0;
  if (hours) total += parseFloat(hours[1]!.replace(",", ".")) * 3600;
  if (minutes) total += parseFloat(minutes[1]!.replace(",", ".")) * 60;
  if (seconds) total += parseInt(seconds[1]!, 10);
  return total > 0 ? Math.round(total) : null;
}

/**
 * Splits a typed ingredient line ("2 ק"ג עגבניות", "15 מלפפון", "מלפפון 15",
 * "פלפל צהוב") into name / quantity / unit. Only known units count as a unit,
 * so the second word of a two-word name is never mistaken for one.
 */
export function parseIngredientLine(line: string): Ingredient {
  const parsed = parseShoppingLine(line);
  return {
    name: parsed.name,
    quantity: parsed.quantity,
    unit: parsed.unit,
    note: null,
    group: null,
    aisle: guessAisle(parsed.name),
  };
}
