/**
 * Scaling a recipe to a different number of servings, the way a cook would
 * do it by hand: multiply, then round to an amount you can actually measure
 * (¼ cup, 1½ tsp, 350 g, 3 eggs) and switch units when the result reads
 * better (3 כפיות → 1 כף, 1500 גרם → 1.5 ק"ג). Pure functions, no
 * dependencies, so the app, the server and the shopping list agree.
 */

export interface Quantified {
  quantity: number | null;
  unit: string | null;
  name?: string;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
type Family = "tsp" | "tbsp" | "cup" | "g" | "kg" | "ml" | "l" | "count" | "pack" | "other";

const UNIT_FAMILY: Record<string, Family> = {
  כפית: "tsp",
  כפיות: "tsp",
  כף: "tbsp",
  כפות: "tbsp",
  כוס: "cup",
  כוסות: "cup",
  גרם: "g",
  גר: "g",
  ג: "g",
  g: "g",
  gr: "g",
  קג: "kg",
  קילו: "kg",
  קילוגרם: "kg",
  kg: "kg",
  מל: "ml",
  ml: "ml",
  ליטר: "l",
  ליטרים: "l",
  l: "l",
  יחידה: "count",
  יחידות: "count",
  יח: "count",
  יחי: "count",
  שן: "count",
  שיני: "count",
  שיניים: "count",
  פרוסה: "count",
  פרוסות: "count",
  חבילה: "pack",
  חבילות: "pack",
  קופסה: "pack",
  קופסא: "pack",
  קופסאות: "pack",
  פחית: "pack",
  פחיות: "pack",
  שקית: "pack",
  שקיות: "pack",
  גביע: "pack",
  גביעים: "pack",
  צרור: "pack",
  צרורות: "pack",
  בקבוק: "pack",
  בקבוקים: "pack",
  מארז: "pack",
  מארזים: "pack",
  קרטון: "pack",
  קרטונים: "pack",
};

function normalizeUnit(unit: string | null): string {
  return (unit ?? "").replace(/[״׳'"`.]/g, "").trim().toLowerCase();
}

export function unitFamily(unit: string | null): Family {
  if (!unit) return "count";
  return UNIT_FAMILY[normalizeUnit(unit)] ?? "other";
}

const COUNT_PLURALS: Record<string, string> = {
  שן: "שיני",
  פרוסה: "פרוסות",
  יחידה: "יחידות",
  חבילה: "חבילות",
  קופסה: "קופסאות",
  קופסא: "קופסאות",
  פחית: "פחיות",
  שקית: "שקיות",
  גביע: "גביעים",
  צרור: "צרורות",
  בקבוק: "בקבוקים",
  מארז: "מארזים",
  קרטון: "קרטונים",
};
const COUNT_SINGULARS: Record<string, string> = Object.fromEntries(Object.entries(COUNT_PLURALS).map(([s, p]) => [p, s]));

/** Hebrew unit words agree in number: 1 כוס, 2 כוסות, ½ כוס, 1½ כוסות, 2 שיני שום. */
function unitLabel(family: Family, qty: number, original: string | null): string | null {
  if ((family === "count" || family === "pack") && original) {
    const key = normalizeUnit(original);
    if (qty > 1 && COUNT_PLURALS[key]) return COUNT_PLURALS[key]!;
    if (qty <= 1 && COUNT_SINGULARS[key]) return COUNT_SINGULARS[key]!;
    return original;
  }
  switch (family) {
    case "tsp":
      return qty > 1 ? "כפיות" : "כפית";
    case "tbsp":
      return qty > 1 ? "כפות" : "כף";
    case "cup":
      return qty > 1 ? "כוסות" : "כוס";
    case "g":
      return "גרם";
    case "kg":
      return 'ק"ג';
    case "ml":
      return 'מ"ל';
    case "l":
      return "ליטר";
    default:
      return original;
  }
}

// ---------------------------------------------------------------------------
// Rounding to amounts a cook can measure
// ---------------------------------------------------------------------------
const SPOON_FRACTIONS = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1];
const TSP_FRACTIONS = [0, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1];

function nearest(value: number, candidates: number[]): number {
  let best = candidates[0]!;
  for (const c of candidates) if (Math.abs(c - value) < Math.abs(best - value)) best = c;
  return best;
}

/** Whole part plus the closest kitchen fraction (¼, ⅓, ½, ⅔, ¾; ⅛ for teaspoons). */
function roundToFraction(value: number, fractions: number[]): number {
  const whole = Math.floor(value);
  const frac = nearest(value - whole, fractions);
  const result = whole + frac;
  return result === 0 ? fractions.find((f) => f > 0)! : result;
}

function isClean(value: number, step: number): boolean {
  const n = value / step;
  return Math.abs(n - Math.round(n)) < 0.02;
}

function roundStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Grams and millilitres: 1 g under 20, 5 g under 100, 10 g under 1000, 50 g above. */
function roundMetric(value: number): number {
  if (value < 20) return Math.max(1, Math.round(value));
  if (value < 100) return roundStep(value, 5);
  if (value < 1000) return roundStep(value, 10);
  return roundStep(value, 50);
}

const EGG = /^ביצ(ה|ים)?(\s|$)/;

function roundCount(value: number, name: string | undefined): number {
  if (name && EGG.test(name)) return Math.max(1, Math.round(value));
  if (value >= 2) return Math.round(value);
  // half an onion, 1½ lemons
  return Math.max(0.5, roundStep(value, 0.5));
}

// ---------------------------------------------------------------------------
// The scaler
// ---------------------------------------------------------------------------
/**
 * Multiplies the quantity by `factor` and returns a measurable amount with
 * the unit that reads best. Items without a quantity ("מלח לפי הטעם") pass
 * through untouched. A factor of 1 still tidies the amount (2 כוס → 2 כוסות).
 */
export function scaleQuantity<T extends Quantified>(item: T, factor: number): T {
  if (item.quantity === null || !Number.isFinite(item.quantity) || factor <= 0) return item;
  const raw = item.quantity * factor;
  const family = unitFamily(item.unit);
  const [qty, fam] = settle(raw, family);
  const unit = unitLabel(fam, qty, item.unit);
  if (qty === item.quantity && unit === item.unit) return item;
  return { ...item, quantity: qty, unit };
}

/** Picks the unit and rounding for a raw amount in the given unit family. */
function settle(raw: number, family: Family, name?: string): [number, Family] {
  switch (family) {
    case "tsp": {
      if (raw >= 3) {
        const tbsp = raw / 3;
        if (isClean(tbsp, 0.5)) return settle(tbsp, "tbsp");
      }
      return [roundToFraction(raw, TSP_FRACTIONS), "tsp"];
    }
    case "tbsp": {
      if (raw < 1) {
        const tsp = raw * 3;
        if (isClean(tsp, 0.25)) return [roundToFraction(tsp, TSP_FRACTIONS), "tsp"];
      }
      if (raw >= 8) {
        const cups = raw / 16;
        if (isClean(cups, 0.25) || isClean(cups, 1 / 3)) return [roundToFraction(cups, SPOON_FRACTIONS), "cup"];
      }
      return [roundToFraction(raw, SPOON_FRACTIONS), "tbsp"];
    }
    case "cup": {
      if (raw < 0.25) {
        const tbsp = raw * 16;
        if (isClean(tbsp, 0.5)) return [roundToFraction(tbsp, SPOON_FRACTIONS), "tbsp"];
      }
      return [roundToFraction(raw, SPOON_FRACTIONS), "cup"];
    }
    case "g": {
      if (raw >= 1000 && isClean(raw / 1000, 0.25)) return [roundStep(raw / 1000, 0.25), "kg"];
      return [roundMetric(raw), "g"];
    }
    case "kg": {
      if (raw < 1 || !isClean(raw, 0.25)) return [roundMetric(raw * 1000), "g"];
      return [roundStep(raw, 0.25), "kg"];
    }
    case "ml": {
      if (raw >= 1000 && isClean(raw / 1000, 0.25)) return [roundStep(raw / 1000, 0.25), "l"];
      return [roundMetric(raw), "ml"];
    }
    case "l": {
      if (raw < 1 || !isClean(raw, 0.25)) return [roundMetric(raw * 1000), "ml"];
      return [roundStep(raw, 0.25), "l"];
    }
    case "count":
      return [roundCount(raw, name), "count"];
    case "pack":
      return [raw < 4 ? Math.max(0.5, roundStep(raw, 0.5)) : Math.round(raw), "pack"];
    default:
      return [raw < 10 ? roundToFraction(raw, SPOON_FRACTIONS) : Math.round(raw), "other"];
  }
}

/** Same as scaleQuantity, but eggs and other countable things know their name. */
export function scaleIngredientSmart<T extends Quantified & { name: string }>(ing: T, factor: number): T {
  if (ing.quantity === null || !Number.isFinite(ing.quantity) || factor <= 0) return ing;
  const family = unitFamily(ing.unit);
  const [qty, fam] = settle(ing.quantity * factor, family, ing.name);
  const unit = unitLabel(fam, qty, ing.unit);
  if (qty === ing.quantity && unit === ing.unit) return ing;
  return { ...ing, quantity: qty, unit };
}

// ---------------------------------------------------------------------------
// Showing a quantity: 1.5 → "1½", 0.333 → "⅓", 0.125 → "⅛", 2 → "2"
// ---------------------------------------------------------------------------
const FRACTION_GLYPHS: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

export function formatQuantity(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "";
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  const match = FRACTION_GLYPHS.find(([f]) => Math.abs(f - frac) < 0.04);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];
  return (Math.round(value * 10) / 10).toString();
}

// ---------------------------------------------------------------------------
// Amounts written inside step text: "מוסיפים 2 כפות שמן ו-3 ביצים"
// ---------------------------------------------------------------------------
const WORD_NUMBERS: Record<string, number> = {
  חצי: 0.5,
  רבע: 0.25,
  שליש: 1 / 3,
  "שלושת רבעי": 0.75,
  "שני שליש": 2 / 3,
  "שתי שליש": 2 / 3,
  אחד: 1,
  אחת: 1,
  שני: 2,
  שתי: 2,
  שניים: 2,
  שתיים: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
  תריסר: 12,
};
const GLYPH_VALUES: Record<string, number> = { "⅛": 0.125, "¼": 0.25, "⅓": 1 / 3, "½": 0.5, "⅔": 2 / 3, "¾": 0.75 };

/** Things counted in steps without a unit word; singular → plural. */
const COUNT_NOUNS: Record<string, string> = {
  ביצה: "ביצים",
  ביצים: "ביצים",
  בצל: "בצלים",
  בצלים: "בצלים",
  לימון: "לימונים",
  לימונים: "לימונים",
  עגבנייה: "עגבניות",
  עגבניה: "עגבניות",
  עגבניות: "עגבניות",
  "תפוח אדמה": "תפוחי אדמה",
  "תפוחי אדמה": "תפוחי אדמה",
  פלפל: "פלפלים",
  פלפלים: "פלפלים",
  גזר: "גזרים",
  גזרים: "גזרים",
  בננה: "בננות",
  בננות: "בננות",
  תפוח: "תפוחים",
  תפוחים: "תפוחים",
  מלפפון: "מלפפונים",
  מלפפונים: "מלפפונים",
  "חזה עוף": "חזות עוף",
  "חזות עוף": "חזות עוף",
  כרעיים: "כרעיים",
  שוקיים: "שוקיים",
  פרגית: "פרגיות",
  פרגיות: "פרגיות",
  "שן שום": "שיני שום",
  "שיני שום": "שיני שום",
  קישוא: "קישואים",
  קישואים: "קישואים",
  חציל: "חצילים",
  חצילים: "חצילים",
  אבוקדו: "אבוקדו",
  פיתה: "פיתות",
  פיתות: "פיתות",
  טורטייה: "טורטיות",
  טורטיות: "טורטיות",
};

/** plural → singular, from the table above (the first singular spelling wins). */
const SINGULAR: Record<string, string> = {};
for (const [single, plural] of Object.entries(COUNT_NOUNS)) if (single !== plural && !SINGULAR[plural]) SINGULAR[plural] = single;

const UNIT_WORDS = Object.keys(UNIT_FAMILY).filter((u) => /[֐-׿]/.test(u));
const UNIT_RE = [...UNIT_WORDS, 'ק"ג', 'מ"ל', "גר'", "ג'", ...Object.keys(COUNT_NOUNS)]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/["'.]/g, (m) => `\\${m}`))
  .join("|");
const WORD_NUMBER_RE = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUMBER_RE = `(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|\\d*[⅛¼⅓½⅔¾]|\\d+\\/\\d+|ו?(?:${WORD_NUMBER_RE}))`;
/** "2 כפות", "חצי כוס", "ושתי כפיות", "3-4 ביצים", "1½ כוסות"; "ו-3 ביצים" works because the dash is the lead. */
const AMOUNT_RE = new RegExp(`(^|[^\\u0590-\\u05FF\\d])${NUMBER_RE}\\s*(?:-\\s*)?([וב]?)(${UNIT_RE})(?=$|[^\\u0590-\\u05FF])`, "g");
/** "כוס וחצי", "כף ורבע" */
const UNIT_AND_HALF_RE = new RegExp(`(^|[^\\u0590-\\u05FF])([וב]?)(${UNIT_RE})\\s+ו(חצי|רבע|שליש)(?=$|[^\\u0590-\\u05FF])`, "g");
/** "בצל אחד", "ביצה אחת", "כוס אחת" */
const UNIT_ONE_RE = new RegExp(`(^|[^\\u0590-\\u05FF])([וב]?)(${UNIT_RE})\\s+(אחד|אחת)(?=$|[^\\u0590-\\u05FF])`, "g");

function parseNumber(token: string): number | null {
  const t = token.trim();
  if (WORD_NUMBERS[t] !== undefined) return WORD_NUMBERS[t]!;
  const glyph = t.match(/^(\d*)([⅛¼⅓½⅔¾])$/);
  if (glyph) return (glyph[1] ? parseInt(glyph[1], 10) : 0) + GLYPH_VALUES[glyph[2]!]!;
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return parseFloat(t.replace(",", "."));
  return null;
}

/** Rounds in the unit's own family without switching units (for ranges, so both ends share the unit). */
function roundInFamily(raw: number, family: Family, name?: string): number {
  switch (family) {
    case "tsp":
      return roundToFraction(raw, TSP_FRACTIONS);
    case "tbsp":
    case "cup":
    case "other":
      return raw < 10 ? roundToFraction(raw, SPOON_FRACTIONS) : Math.round(raw);
    case "g":
    case "ml":
      return roundMetric(raw);
    case "kg":
    case "l":
      return roundStep(raw, 0.25) || roundStep(raw, 0.05);
    case "count":
      return roundCount(raw, name);
    case "pack":
      return raw < 4 ? Math.max(0.5, roundStep(raw, 0.5)) : Math.round(raw);
  }
}

function scaledAmount(value: number, unitWord: string, factor: number, range?: number): string {
  const noun = COUNT_NOUNS[unitWord];
  if (noun) {
    const qty = roundCount(value * factor, unitWord);
    const lo = range !== undefined ? `${formatQuantity(roundCount(range * factor, unitWord))}-` : "";
    return `${lo}${formatQuantity(qty)} ${qty <= 1 && !lo ? SINGULAR[noun] ?? unitWord : noun}`;
  }
  if (range !== undefined) {
    const family = unitFamily(unitWord);
    const lo = roundInFamily(range * factor, family);
    const hi = roundInFamily(value * factor, family);
    return `${formatQuantity(lo)}-${formatQuantity(hi)} ${unitLabel(family, hi, unitWord) ?? unitWord}`;
  }
  const scaled = scaleQuantity({ quantity: value, unit: unitWord }, factor);
  return `${formatQuantity(scaled.quantity)} ${scaled.unit ?? unitWord}`;
}

/**
 * Rewrites the amounts inside a step ("מוסיפים 2 כפות שמן") for another
 * number of servings. Temperatures, times and bare numbers are left alone
 * because only amounts followed by a unit or a countable food are touched.
 * Each phrase is replaced once: results are parked as placeholders so a
 * later pattern cannot scale them a second time.
 */
export function scaleText(text: string, factor: number): string {
  if (factor === 1 || !text) return text;
  const parked: string[] = [];
  const park = (s: string) => {
    parked.push(s);
    return `\u0001${parked.length - 1}\u0001`;
  };
  let out = text.replace(UNIT_AND_HALF_RE, (_m, lead: string, prefix: string, unit: string, part: string) =>
    `${lead}${prefix}${park(scaledAmount(1 + WORD_NUMBERS[part]!, unit, factor))}`,
  );
  out = out.replace(UNIT_ONE_RE, (_m, lead: string, prefix: string, unit: string) => `${lead}${prefix}${park(scaledAmount(1, unit, factor))}`);
  out = out.replace(AMOUNT_RE, (match: string, lead: string, number: string, prefix: string, unit: string) => {
    const numberPart = number.replace(/^ו/, "");
    const joiner = number.startsWith("ו") ? "ו-" : "";
    const range = numberPart.split(/\s*[-–]\s*/);
    if (range.length === 2) {
      const a = parseNumber(range[0]!);
      const b = parseNumber(range[1]!);
      if (a !== null && b !== null) return `${lead}${joiner}${prefix}${park(scaledAmount(b, unit, factor, a))}`;
    }
    const value = parseNumber(numberPart);
    if (value === null) return match;
    return `${lead}${joiner}${prefix}${park(scaledAmount(value, unit, factor))}`;
  });
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => parked[Number(i)]!);
}

// ---------------------------------------------------------------------------
// Which ingredients does a step talk about? ("מוסיפים את שמן הזית" → שמן זית)
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set(["של", "עם", "או", "את", "על", "לפי", "הטעם", "טרי", "טרייה", "טריים", "קצוץ", "קצוצה", "קצוצים", "חתוך", "חתוכה", "גדול", "גדולה", "קטן", "קטנה", "בינוני", "בינונית", "מעט", "קצת", "כמה", "חם", "חמים", "קר", "קרים", "רך", "רכה", "יבש", "יבשה", "לבן", "לבנה", "שחור", "שחורה", "אדום", "אדומה", "ירוק", "ירוקה", "טחון", "טחונה", "גרוס", "גרוסה", "מלא", "מלאה", "רגיל", "רגילה", "כל", "ללא", "בלי"]);

function hebrewWords(s: string): string[] {
  return s
    .replace(/[^֐-׿\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Word stems: strips a plural ending and the feminine ה so ביצים ↔ ביצה, עגבניות ↔ עגבנייה. */
function stems(word: string): string[] {
  const out = new Set<string>([word]);
  if (word.length > 4 && /ים$/.test(word)) out.add(word.slice(0, -2));
  if (word.length > 4 && /ות$/.test(word)) out.add(word.slice(0, -2));
  if (word.length > 4 && /יות$/.test(word)) out.add(word.slice(0, -3));
  if (word.length > 3 && /ה$/.test(word)) out.add(word.slice(0, -1));
  if (word.length > 3 && /ת$/.test(word)) out.add(word.slice(0, -1));
  if (word.length > 4 && /ייה$/.test(word)) out.add(word.slice(0, -3));
  return [...out].filter((s) => s.length >= 2);
}

function wordRe(stem: string): RegExp {
  const prefix = stem.length <= 2 ? "" : "(?:[ובלמכש]|כש|וב|ול|ומ|וה|וכ|ש[בלמה]?)?ה?";
  const suffix = stem.length <= 2 ? "" : "(?:ים|ות|יות|ה|ת|י|ייה|ים|ין)?";
  return new RegExp(`(?:^|[^\\u0590-\\u05FF])${prefix}${stem}${suffix}(?=$|[^\\u0590-\\u05FF])`);
}

/**
 * Indexes of the ingredients a step mentions by name. Every meaningful word
 * of an ingredient's name is matched as a whole word, allowing Hebrew
 * prefixes (ה, ב, ל, ו, מ, ש) and plural/singular endings. Two-letter names
 * (הל, תה) must appear exactly. A step whose text matches nothing but whose
 * `group` matches the ingredients' group gets that group instead.
 */
export function ingredientsForStep(
  step: { text: string; group: string | null },
  ingredients: { name: string; group: string | null }[],
): number[] {
  const text = ` ${step.text} `;
  const hits: number[] = [];
  ingredients.forEach((ing, i) => {
    const words = hebrewWords(ing.name);
    if (!words.length) return;
    // The full name first ("שמן זית"), then single meaningful words (≥3 letters).
    const whole = words.join(" ");
    if (text.includes(` ${whole} `) || text.includes(` ה${whole} `) || text.includes(` ב${whole} `)) {
      hits.push(i);
      return;
    }
    const matched = words.some((w) => stems(w).some((s) => (s.length >= 3 || w === s) && wordRe(s).test(text)));
    if (matched) hits.push(i);
  });
  if (!hits.length && step.group) {
    const g = step.group.replace(/^ל/, "");
    ingredients.forEach((ing, i) => {
      if (ing.group && (ing.group.replace(/^ל/, "") === g || ing.group.includes(g) || g.includes(ing.group.replace(/^ל/, "")))) hits.push(i);
    });
  }
  return hits;
}
