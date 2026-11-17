import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  LESSONS,
  RecipeAISchema,
  StepSchema,
  deepLesson,
  formatQuantity,
  normalizeRecipeContent,
  type Ingredient,
  type Lesson,
  type RecipeContent,
  type Step,
  type WhyNote,
} from "@recipe/shared";
import { z } from "zod";
import { env } from "./env.js";

/**
 * The cooking coach: the two places where the cook talks with the model.
 *   askCoach   - a question from anywhere: inside a lesson ("why not olive oil?"),
 *     on a recipe ("what can replace the cream, how much and when?"), or in general.
 *   applyToRecipe - turns what was suggested in a recipe conversation into edits of
 *     that recipe. It only prepares them: the cook sees the changes and saves, or not.
 *   chefTurn / chefBuild - "לבשל עם קורט": the model asks what there is, for how
 *     many, how much time, proposes a dish or a whole meal, and then writes it.
 * Both stand on the same foundations as the course, and point back at lessons.
 */
const client = new Anthropic();

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const LESSON_INDEX = LESSONS.map((l) => `${l.id} | שיעור ${l.number}: ${l.title} | ${l.cards.map((c) => c.title).join("; ")}`).join("\n");

/** What every answer and every dish must respect. The course teaches these one by one. */
const FOUNDATIONS = `Cooking foundations (the same ones the cook is learning in the course):
1. Salt: it amplifies flavour that is already there. Timing matters more than amount: meat 40+ minutes ahead or right before the pan, never in between; pasta and blanching water salted like mild sea water; mushrooms and anything you want browned are salted after browning; always taste and correct at the end.
2. Fat: carries flavour and heat. Choose it by temperature (refined oil for a hard sear, olive oil for medium heat and for finishing). A dish that tastes thin may need fat, a dish that feels heavy needs acid, not more salt.
3. Acid: lemon, vinegar, yogurt, tomato, wine. Brightens and cuts fat. Almost every rich dish gets something acidic at the end, not during long cooking.
4. Heat: match the method to the ingredient. Tender cuts and vegetables: fast and hot. Tough cuts with connective tissue: low and long with moisture. Know what the pan temperature is doing: above ~150C browning, at 100C steaming.
5. Browning: Maillard and caramelisation create flavour that was not there. Needs a dry surface, a hot pan and space (never crowd; work in batches). The brown bits left in the pan (fond) become the sauce.
6. Aromatics in order: onion first (minutes), garlic late (seconds), ground spices bloomed briefly in the fat, then liquid. Fresh herbs: hardy ones early, soft ones at the end.
7. Texture: every plate wants contrast - something crisp or fresh against something soft or rich.
8. What goes with what: rich with acidic, sweet with salty, bitter with fat, hot (chili) with dairy or sweetness; herbs and spices by family and region (a dish usually stays inside one cuisine's logic).
9. Umami: tomato paste, mushrooms, soy, anchovy, parmesan, slow-browned onion deepen a dish that tastes "empty" even though it is salted.
10. Carry-over and rest: food keeps cooking off the heat; meat rests before cutting.
11. A meal, not a pile of dishes: at most one rich/heavy item, one fresh or acidic side, variety of colour and temperature, and not three things that all need the same burner or the oven at different temperatures at the same moment.
12. Quantities per adult: 150-200 g raw meat or fish (250 g on the bone), 80-100 g dry pasta/rice/grain, 150-200 g vegetables as a side; children roughly half. Scale to the number of eaters and say so.
13. Timing for the number of people: what is made ahead, what rests, what must be last-minute; one pan sears about two steaks at a time.`;

const VOICE = `Write in plain everyday Hebrew, warm and direct, like a friend who cooks well. Speak to the cook in the plural ("אתם", "קחו", "הוסיפו"), never with slashes like "את/ה". No markdown, no bullet symbols, no emojis, no headings: short paragraphs only. Explain any technical word in the same sentence. Temperatures in Celsius, metric quantities. Never invent facts: if something depends on the cut, the pan or the oven, say what it depends on. Food safety comes first (poultry and minced meat cooked through, no risky shortcuts). When a course lesson covers the point, mention it by number and name, for example "(שיעור 5, השחמה)".`;

// ---------------------------------------------------------------------------
// One call to the model, with the same error wording everywhere.
// ---------------------------------------------------------------------------
/** Sonnet 5.5 and the Opus line can hand a declined request to a fallback model inside the same call. */
const SERVER_FALLBACK = /sonnet-5-5|opus-5|fable-5/.test(env.coachModel);

type Params = Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "model" | "betas" | "fallbacks">;

/** Generic so that the structured-output type of `output_config.format` survives to `parsed_output`. */
function request<P extends Params>(params: P) {
  const fallback: Pick<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "betas" | "fallbacks"> = SERVER_FALLBACK
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
  return { ...params, model: env.coachModel, ...fallback };
}

function explain(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw new Error("יותר מדי בקשות כרגע. נסו שוב בעוד דקה.");
  if (err instanceof Anthropic.APIConnectionError) throw new Error("אין חיבור למודל כרגע. נסו שוב.");
  if (err instanceof Anthropic.APIError) throw new Error(`שגיאה מול Claude (${err.status}): ${err.message}`);
  console.error("[coach] call failed", err);
  throw new Error("משהו השתבש בתשובה. נסו שוב.");
}

function checkStop(reason: string | null) {
  if (reason === "refusal") throw new Error("על זה אני לא יכול לענות. נסו לנסח אחרת.");
  if (reason === "max_tokens") throw new Error("התשובה יצאה ארוכה מדי. נסו לבקש משהו קצר יותר.");
}

/** History as the API wants it: starts with the cook, never empty messages. */
function toMessages(history: ChatMessage[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const cleaned = history.filter((m) => m.text.trim());
  while (cleaned.length && cleaned[0]!.role !== "user") cleaned.shift();
  return cleaned.map((m) => ({ role: m.role, content: m.text }));
}

// ---------------------------------------------------------------------------
// A question inside a lesson
// ---------------------------------------------------------------------------
function lessonText(lesson: Lesson): string {
  const deep = deepLesson(lesson.id);
  const parts = [
    `<lesson id="${lesson.id}" number="${lesson.number}" title="${lesson.title}">`,
    ...lesson.cards.map((c) => `${c.title}: ${c.text}`),
    `ניסוי: ${lesson.experiment.title}. ${lesson.experiment.steps.join(" ")}`,
  ];
  if (deep) {
    parts.push(
      "תקלות נפוצות:",
      ...deep.failures.map((f) => `${f.symptom}. סיבה: ${f.cause} תיקון: ${f.fix}`),
      "מנות התרגול:",
      ...deep.dishes.map((d) => `${d.title}: ${d.steps.map((s) => s.text).join(" ")}`),
    );
  }
  parts.push("</lesson>");
  return parts.join("\n");
}

/** The recipe the cook is looking at, as the model reads it. Quantities are as stored. */
export interface AskRecipe {
  title: string;
  servings: number | null;
  ingredients: { name: string; quantity: number | null; unit: string | null; note: string | null; group: string | null }[];
  steps: { text: string; group: string | null }[];
  notes: string | null;
}

function ingredientText(i: AskRecipe["ingredients"][number]): string {
  return `${i.group ? `[${i.group}] ` : ""}${[i.quantity, i.unit, i.name].filter((x) => x !== null && x !== "").join(" ")}${i.note ? ` (${i.note})` : ""}`;
}

/** `numbered`: ingredients get numbers too, so that an edit can point at one. */
function recipeText(recipe: AskRecipe, makingServings: number | null, numbered = false): string {
  const scaled = makingServings && recipe.servings && makingServings !== recipe.servings;
  const lines = [`<recipe title="${recipe.title}" written_for_servings="${recipe.servings ?? "unknown"}"${scaled ? ` cook_is_making_servings="${makingServings}"` : ""}>`, "<ingredients>"];
  recipe.ingredients.forEach((i, n) => lines.push(`${numbered ? `${n + 1}. ` : ""}${ingredientText(i)}`));
  lines.push("</ingredients>", "<steps>");
  recipe.steps.forEach((st, n) => lines.push(`${n + 1}. ${st.group ? `[${st.group}] ` : ""}${st.text}`));
  lines.push("</steps>");
  if (recipe.notes?.trim()) lines.push(`<family_notes>${recipe.notes.trim()}</family_notes>`);
  lines.push("</recipe>");
  return lines.join("\n");
}

const ASK_SYSTEM = `You are Kort, the cooking teacher inside a family's recipe app. The cook asks you a question from one of three places: inside a lesson of the app's cooking course, on the page of one of the family's own recipes (possibly while cooking it), or from anywhere else in the app. When there is a lesson or a recipe, it follows this prompt.

Answer the question that was asked, in two to five sentences: first the direct answer, then the reason (what physically or chemically happens), then, if it helps, one thing to do differently at the stove. If you are not sure, say so. If the cook describes a result that went wrong, diagnose it: name the most likely cause first and how to check it.

Inside a lesson: do not repeat the lesson back; add to it. A question outside the lesson is answered anyway, briefly.

On a recipe: the answer is about THIS recipe, its quantities and its steps.
- Swapping or adding an ingredient: say what to use, how much (worked out from this recipe's own quantities; if the cook is making a different number of servings than the recipe was written for, give the amount for what they are making and say so), at which step it goes in (by its number, "בשלב 3"), and what changes because of it: time, liquid, salt, texture, taste. If the swap does not work in this dish, say so plainly and give the nearest thing that does. If an ingredient can simply be left out, say that.
- Making ahead, storing, reheating, doubling, a different pan or oven: answer from the recipe's actual steps, naming the step where things change.
- Do not rewrite the whole recipe. Change only what the question needs.
- If the question is too open to answer well ("what can I replace?"), ask which ingredient, in one short sentence.

${VOICE}

${FOUNDATIONS}

All lessons of the course (id | number and title | topics):
${LESSON_INDEX}`;

export interface AskContext {
  lesson?: Lesson | null;
  recipe?: AskRecipe | null;
  /** How many servings the cook has set on the recipe page, when different from the recipe's own. */
  servings?: number | null;
}

/** On a recipe the answer also says whether it holds a change that could be written into the recipe. */
const RecipeAnswerSchema = z.object({
  reply: z.string().describe("התשובה לבשלן, בעברית, לפי כל הכללים"),
  changes_recipe: z
    .boolean()
    .describe(
      "true רק כשהתשובה מציעה שינוי מוחשי במתכון כפי שהוא כתוב (החלפה, הוספה או הורדה של מצרך, כמות אחרת, זמן או שיטה אחרים) שאפשר לכתוב לתוך המתכון. false להסבר, לאבחון תקלה, לעצות אחסון והכנה מראש, ולשאלת הבהרה",
    ),
});

const RECIPE_BUTTON = `You cannot edit the recipe yourself. Under an answer of yours that holds a concrete change, the app shows a button "לעדכן את המתכון לפי ההצעה": it shows the cook exactly what would change and saves only if they approve. If the cook asks you to update, fix or save the recipe, say in one sentence that this button does it (when the conversation already holds a concrete change, set changes_recipe to true so the button appears; when it does not, ask what to change). Never say that you changed the recipe.

A line in the conversation that starts with "עדכנתי את המתכון" was written by the app after the cook approved such an update: it is a fact, and the recipe below already includes those changes, so answer from the recipe as it is now and do not comment on that line. A line "ביטלתי את העדכון" means the cook undid the last update and the recipe below is back to what it was.`;

export interface CoachAnswer {
  reply: string;
  /** Only ever true on a recipe: the app then offers to write the change into it. */
  changes_recipe: boolean;
}

export async function askCoach(context: AskContext, history: ChatMessage[]): Promise<CoachAnswer> {
  const messages = toMessages(history);
  if (!messages.length) throw new Error("חסרה שאלה");
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }];
  if (context.lesson) system.push({ type: "text", text: `The lesson the cook is in right now:\n${lessonText(context.lesson)}` });

  if (context.recipe) {
    system.push({ type: "text", text: `${RECIPE_BUTTON}\n\nThe recipe the cook is asking about:\n${recipeText(context.recipe, context.servings ?? null)}` });
    const response = await client.beta.messages
      .parse(request({ max_tokens: 4000, system, messages, output_config: { effort: "low", format: zodOutputFormat(RecipeAnswerSchema) } }))
      .catch(explain);
    checkStop(response.stop_reason);
    const reply = response.parsed_output?.reply.trim();
    if (!reply) throw new Error("לא קיבלתי תשובה. נסו שוב.");
    return { reply, changes_recipe: response.parsed_output!.changes_recipe };
  }

  const response = await client.beta.messages
    .create(request({ max_tokens: 4000, system, messages, output_config: { effort: "low" } }))
    .catch(explain);
  checkStop(response.stop_reason);
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("לא קיבלתי תשובה. נסו שוב.");
  return { reply: text, changes_recipe: false };
}

// ---------------------------------------------------------------------------
// Writing a suggestion into the recipe.
// The model does not rewrite the recipe: it returns a short list of edits that
// point at the ORIGINAL ingredient and step numbers. They are applied here, so
// every line the suggestion does not touch stays exactly as it was, and the
// preview the cook approves is made from the same edits that get saved.
// ---------------------------------------------------------------------------
const ACTION = z.enum(["replace", "remove", "add"]);

const EditsSchema = z.object({
  summary: z.string().describe("משפט אחד בעברית: מה משתנה במתכון. ריק כשאין מה לשנות"),
  ingredient_edits: z.array(
    z.object({
      action: ACTION,
      number: z
        .number()
        .nullable()
        .describe("מספר המצרך ברשימה המקורית. חובה ב-replace וב-remove. ב-add: המצרך שאחריו נכנס החדש, או null לסוף הרשימה"),
      ingredient: RecipeAISchema.shape.ingredients.element.nullable().describe("המצרך החדש במלואו ב-replace וב-add. null ב-remove"),
    }),
  ),
  step_edits: z.array(
    z.object({
      action: ACTION,
      number: z
        .number()
        .nullable()
        .describe("מספר השלב המקורי. חובה ב-replace וב-remove. ב-add: השלב שאחריו נכנס החדש, 0 = לפני השלב הראשון"),
      step: StepSchema.nullable().describe("השלב החדש במלואו ב-replace וב-add. null ב-remove"),
    }),
  ),
  title: z.string().nullable().describe("שם חדש למתכון רק אם השם הנוכחי מזכיר מצרך שהוחלף או ירד. אחרת null"),
});

const APPLY_SYSTEM = `You are Kort, the cooking teacher inside a family's recipe app. The cook talked with you about one of the family's recipes (the conversation follows) and now pressed "update the recipe according to the suggestion". Turn what was agreed in the conversation into edits of the recipe below. The app shows the cook your edits and saves them only if they approve.

Which changes: the concrete changes to the recipe that you suggested in the conversation and the cook did not turn down. When you offered alternatives, take the one the cook chose; if they did not choose, the one you recommended first. A line in the conversation that says the recipe was already updated means those changes are in the recipe below: do not repeat them. If the conversation holds no concrete change to the recipe (only an explanation, a diagnosis, or advice about storing and making ahead), return empty lists and an empty summary.

How to write the edits:
- Numbers always refer to the recipe as it is given below (the original numbering), also when you add or remove other lines.
- Touch only what the change needs. Do not list an ingredient or a step that stays the same, do not improve wording, do not reorder.
- The recipe must read correctly from top to bottom afterwards: every step that names a replaced or removed ingredient, or whose time, heat or order changes because of it, gets a "replace" with its full new text. A step you replace keeps its wording wherever the change does not touch it. Something from the conversation that the cook should now skip or reduce (salt, liquid, a few minutes of cooking) is written into the step where it happens. The same goes for the note of another ingredient that names a replaced one ("לתרד ולסיום"): replace that ingredient with only its note corrected.
- Quantities are for the number of servings the recipe is WRITTEN for (written_for_servings). If the conversation gave amounts for a different number of servings, convert them back.
- A new or replaced ingredient is complete: name without the amount, quantity, unit, note, the same "group" label as its neighbours when the recipe has groups, and the supermarket aisle. A new or replaced step keeps the "group" of its place, and has duration_seconds when it waits.
- Steps are short, one action each, in plain Hebrew, in the same style as the recipe's own steps. No markdown, no emojis.
- Food safety comes first: never write an edit that leaves poultry or minced meat undercooked.

${FOUNDATIONS}`;

export interface RecipeChange {
  where: "ingredient" | "step" | "title";
  kind: "add" | "remove" | "change";
  /** "שלב 4", "שלב חדש אחרי 4", or null for an ingredient. */
  label: string | null;
  before: string | null;
  after: string | null;
}

export interface RecipeEdit {
  summary: string;
  changes: RecipeChange[];
  /** What to PATCH into the recipe when the cook approves. Empty when there is nothing to change. */
  patch: { title?: string; ingredients?: Ingredient[]; steps?: Step[] };
}

/** The recipe as stored: the edit keeps every untouched line of it. */
export interface EditableRecipe extends RecipeContent {
  notes: string | null;
}

function ingredientLabel(i: Ingredient): string {
  return `${[formatQuantity(i.quantity), i.unit, i.name].filter(Boolean).join(" ")}${i.note ? ` (${i.note})` : ""}`;
}

/**
 * Applies edits that point at original numbers. One edit per original line (the
 * first wins); additions keep the order the model gave them.
 */
function applyEdits<T>(
  original: T[],
  edits: { action: "replace" | "remove" | "add"; number: number | null; item: T | null }[],
): { result: T[]; replaced: Map<number, T>; removed: Set<number>; added: { after: number; item: T }[] } {
  const replaced = new Map<number, T>();
  const removed = new Set<number>();
  const added: { after: number; item: T }[] = [];
  for (const e of edits) {
    const n = e.number === null ? null : Math.round(e.number);
    if (e.action === "add") {
      if (!e.item) continue;
      added.push({ after: n === null ? original.length : Math.min(Math.max(n, 0), original.length), item: e.item });
    } else if (n !== null && n >= 1 && n <= original.length && !replaced.has(n) && !removed.has(n)) {
      if (e.action === "remove") removed.add(n);
      else if (e.item) replaced.set(n, e.item);
    }
  }
  const result: T[] = [];
  const addAfter = (n: number) => added.filter((a) => a.after === n).forEach((a) => result.push(a.item));
  addAfter(0);
  original.forEach((item, i) => {
    const n = i + 1;
    if (replaced.has(n)) result.push(replaced.get(n)!);
    else if (!removed.has(n)) result.push(item);
    addAfter(n);
  });
  return { result, replaced, removed, added };
}

export async function applyToRecipe(recipe: EditableRecipe, makingServings: number | null, history: ChatMessage[]): Promise<RecipeEdit> {
  const messages = toMessages(history);
  if (!messages.length) throw new Error("אין עדיין שיחה שאפשר לעדכן לפיה.");
  const response = await client.beta.messages
    .parse(
      request({
        max_tokens: 8000,
        system: [
          { type: "text", text: APPLY_SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: `The recipe to edit:\n${recipeText(recipe, makingServings, true)}` },
        ],
        messages: [...messages, { role: "user", content: "עדכן את המתכון לפי מה שהצעת בשיחה." }],
        output_config: { effort: "medium", format: zodOutputFormat(EditsSchema) },
      }),
    )
    .catch(explain);
  checkStop(response.stop_reason);
  const out = response.parsed_output;
  if (!out) throw new Error("לא הצלחתי להכין את העדכון. נסו שוב.");

  // New ingredients go through the same clean-up as an imported recipe (aisle names).
  const cleanIngredient = (ing: NonNullable<(typeof out.ingredient_edits)[number]["ingredient"]>): Ingredient =>
    normalizeRecipeContent({ ...recipe, ingredients: [{ ...ing, name: ing.name.trim() }], steps: [] }).ingredients[0]!;
  const ing = applyEdits<Ingredient>(
    recipe.ingredients,
    out.ingredient_edits.map((e) => ({ action: e.action, number: e.number, item: e.ingredient?.name.trim() ? cleanIngredient(e.ingredient) : null })),
  );
  const st = applyEdits<Step>(
    recipe.steps,
    out.step_edits.map((e) => ({ action: e.action, number: e.number, item: e.step?.text.trim() ? { ...e.step, text: e.step.text.trim() } : null })),
  );

  const changes: RecipeChange[] = [];
  recipe.ingredients.forEach((old, i) => {
    const n = i + 1;
    if (ing.removed.has(n)) changes.push({ where: "ingredient", kind: "remove", label: null, before: ingredientLabel(old), after: null });
    const next = ing.replaced.get(n);
    if (next && ingredientLabel(next) !== ingredientLabel(old))
      changes.push({ where: "ingredient", kind: "change", label: null, before: ingredientLabel(old), after: ingredientLabel(next) });
  });
  ing.added.forEach((a) => changes.push({ where: "ingredient", kind: "add", label: null, before: null, after: ingredientLabel(a.item) }));

  // Steps in the order they will be read, numbered as they are today (that is what the cook knows).
  const stepAdds = (n: number) =>
    st.added
      .filter((a) => a.after === n)
      .forEach((a) => changes.push({ where: "step", kind: "add", label: n === 0 ? "שלב חדש בהתחלה" : `שלב חדש אחרי שלב ${n}`, before: null, after: a.item.text }));
  stepAdds(0);
  recipe.steps.forEach((old, i) => {
    const n = i + 1;
    if (st.removed.has(n)) changes.push({ where: "step", kind: "remove", label: `שלב ${n}`, before: old.text, after: null });
    const next = st.replaced.get(n);
    if (next && next.text !== old.text) changes.push({ where: "step", kind: "change", label: `שלב ${n}`, before: old.text, after: next.text });
    stepAdds(n);
  });

  const title = out.title?.trim();
  const newTitle = title && title !== recipe.title ? title : null;
  const touched = (where: RecipeChange["where"]) => changes.some((c) => c.where === where);
  // A new name alone is not a change to the recipe.
  if (newTitle && changes.length) changes.unshift({ where: "title", kind: "change", label: null, before: recipe.title, after: newTitle });

  if (!touched("ingredient") && !touched("step")) return { summary: "", changes: [], patch: {} };
  if (!st.result.length || !ing.result.length) throw new Error("העדכון היה מוחק את כל המתכון, אז לא הכנתי אותו. נסו לנסח את הבקשה אחרת.");
  return {
    summary: out.summary.trim(),
    changes,
    patch: {
      ...(newTitle ? { title: newTitle } : {}),
      ...(touched("ingredient") ? { ingredients: ing.result } : {}),
      ...(touched("step") ? { steps: st.result } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// "לבשל עם קורט": the conversation
// ---------------------------------------------------------------------------
const Principle = z.object({
  text: z.string().describe("משפט או שניים בעברית: מה עושים במנה הזאת ולמה זה עובד"),
  lesson_id: z.string().nullable().describe("מזהה השיעור המתאים מהרשימה, או null"),
});

const ProposalSchema = z.object({
  title: z.string().describe("שם קצר בעברית למנה או לארוחה"),
  servings: z.number().describe("לכמה סועדים"),
  dishes: z
    .array(
      z.object({
        name: z.string().describe("שם המנה בעברית"),
        role: z.string().describe("התפקיד בארוחה: 'עיקרית', 'תוספת', 'סלט', 'רוטב', 'קינוח'..."),
        idea: z.string().describe("משפט אחד: מה זה ואיך זה נעשה"),
      }),
    )
    .describe("מנה אחת, או כמה מנות כשמדובר בארוחה (עד 4)"),
  principles: z.array(Principle).describe("3 עד 5 סיבות מהיסודות: למה ההצעה הזאת בנויה נכון"),
});
export type ChefProposal = z.infer<typeof ProposalSchema>;

const TurnSchema = z.object({
  say: z.string().describe("מה קורט אומר עכשיו לבשלן: שאלה אחת, או הצגה קצרה של ההצעה"),
  options: z.array(z.string()).describe("2 עד 5 תשובות קצרות (עד 4 מילים) לשאלה שב-say, להקשה. ריק כשאין שאלה סגורה"),
  proposal: ProposalSchema.nullable().describe("ההצעה, כשיש מספיק מידע. אחרת null"),
});
export type ChefTurn = z.infer<typeof TurnSchema>;

const CHEF_SYSTEM = `You are Kort, a cooking coach inside a family's recipe app in Israel. The cook wants to build a dish, or a whole meal, together with you: not from an existing recipe but from what they have, what they feel like and who is eating. The app has already greeted them and asked "מה מבשלים?".

How the conversation goes:
- Ask ONE question at a time, with 2 to 5 short tappable answers in "options" (the cook can always type something else). Never ask what you already know from the conversation.
- What you need before proposing: one dish or a whole meal and the occasion; how many eaters (adults and children); a main ingredient, or what is in the house and should be used; how much time until eating; the equipment that matters (oven, grill, stove only); limits (kosher style with no meat and dairy together, vegetarian, allergies, picky children); the direction they feel like (comforting, light, festive, a cuisine).
- Four or five questions at most. If the cook says "surprise me" or seems impatient, stop asking and decide yourself, stating your assumptions in one sentence.
- Then propose, in "proposal": a title, the dishes with their roles and a one-sentence idea each, and 3 to 5 principles that show the proposal is built on the foundations below (balance of salt, fat, acid and heat; browning for flavour; texture contrast; what goes with what; a meal that is not three heavy things; timing that works for this number of people and this equipment). Tie each principle to a lesson id when one fits. In "say", present the proposal in two or three sentences and ask whether to build it; put in "options" a yes ("נשמע טוב, תבנה") and one or two realistic changes.
- One dish is ONE entry in "dishes", even when it has parts (a fish, the greens cooked next to it and a sauce are one dish: the recipe has groups for that). Use several entries only for a real meal, where each entry could be served and saved as a recipe of its own.
- If the cook asks for a change, return a new full proposal. Keep "proposal" non-null in every turn after the first proposal, unless you had to go back to asking.
- Do not write quantities or full steps in the conversation. When the cook approves, the app builds the full recipes in a separate step.
- Be honest about limits: if the time or equipment cannot produce what they asked for (a 3-hour braise in 40 minutes), say so and offer the nearest thing that works.

${VOICE}

${FOUNDATIONS}

Lessons of the course, for lesson_id (id | number and title | topics):
${LESSON_INDEX}`;

const knownLessons = new Set(LESSONS.map((l) => l.id));
function cleanNotes(notes: { text: string; lesson_id: string | null }[], max: number): WhyNote[] {
  return notes.slice(0, max).map((n) => ({
    text: n.text.trim(),
    lesson_id: n.lesson_id && knownLessons.has(n.lesson_id) ? n.lesson_id : null,
  }));
}

export async function chefTurn(history: ChatMessage[]): Promise<ChefTurn> {
  const messages = toMessages(history);
  if (!messages.length) throw new Error("חסרה הודעה");
  const response = await client.beta.messages
    .parse(
      request({
        max_tokens: 6000,
        system: [{ type: "text", text: CHEF_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: "low", format: zodOutputFormat(TurnSchema) },
      }),
    )
    .catch(explain);
  checkStop(response.stop_reason);
  const out = response.parsed_output;
  if (!out) throw new Error("לא הצלחתי לענות הפעם. נסו שוב.");
  return {
    say: out.say.trim(),
    options: out.options.map((o) => o.trim()).filter(Boolean).slice(0, 5),
    proposal: out.proposal
      ? { ...out.proposal, dishes: out.proposal.dishes.slice(0, 4), principles: cleanNotes(out.proposal.principles, 5) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// "לבשל עם קורט": writing the approved proposal as full recipes.
// One call per dish, all at once (a three-dish meal in one call took close to
// two minutes), then one short call for the working order of the whole meal.
// ---------------------------------------------------------------------------
const DishSchema = z.object({
  recipe: RecipeAISchema,
  why: z.array(Principle).describe("2 עד 4 הערות 'למה זה עובד' על המנה הזאת"),
});

const TimelineSchema = z.object({
  timeline: z
    .array(
      z.object({
        when: z.string().describe("מתי, ביחס להגשה: '60 דקות לפני', '10 דקות לפני', 'ברגע האחרון'"),
        text: z.string().describe("מה עושים אז, במשפט אחד"),
      }),
    )
    .describe("סדר העבודה לכל הארוחה, מהמוקדם למאוחר"),
});

export interface ChefBuilt {
  dishes: { recipe: RecipeContent; why: WhyNote[] }[];
  timeline: { when: string; text: string }[];
}

const BUILD_SYSTEM = `You are Kort, a cooking coach inside a family's recipe app in Israel. You and the cook agreed on a dish or a meal (the conversation and the approved proposal follow). Now write ONE dish of it in full, the one named at the end, so that it can be cooked tonight and saved in the family's recipe book. The other dishes of the meal are written separately; do not include them, but do fit this dish to them (shared oven temperature, timing, not repeating the same flavour).

The recipe, in the given schema, in Hebrew:
- Quantities scaled to the agreed number of eaters, metric, with the unit words the schema asks for. Every ingredient that appears in a step appears in the list, salt and oil included.
- Steps are short, one action each, in the order they happen, and they carry the foundations inside them: dry the surface, heat the pan until the oil shimmers, do not crowd, when the salt goes in, when the acid goes in, how long it rests, and what to look or listen for ("עד שהבצל שקוף", "עד שהקרום משתחרר לבד") rather than a bare time. Give duration_seconds for steps that wait. A step may give its reason in a few words; it never contradicts another step or the oven temperature you set.
- Keep what the approved proposal promised (its ideas and its principles). If the time or the ingredients force a different choice, make it and say so in "warnings".
- Use only what the cook said they have plus ordinary pantry items (oil, salt, pepper, onion, garlic, lemon, common spices), and say in "warnings" if you assumed anything they did not mention.
- Respect every limit from the conversation (kosher style, vegetarian, allergies, children), the time and the equipment.
- "confidence" is "high" unless you had to guess something important. "original_language" is "he". Tags: up to 6, and include "קורט".
- "why": 2 to 4 notes about what makes this dish work, each tied to a lesson id when one fits.

${VOICE} (The schema fields are the exception: fill them as described.)

${FOUNDATIONS}

Lessons of the course, for lesson_id (id | number and title | topics):
${LESSON_INDEX}`;

const TIMELINE_SYSTEM = `You are Kort, a cooking coach. The cook is about to make the meal below (full recipes given). Write the working order for the whole meal, counted back from the moment of serving, so that everything is ready together: what is done ahead, what shares the oven, what rests, what is last-minute. One line per moment, 5 to 9 lines, earliest first. Use the times in the recipes; do not invent steps that are not in them. Plain Hebrew, no markdown, no emojis.`;

function approvedText(proposal: ChefProposal): string {
  return [
    `<approved_proposal title="${proposal.title}" servings="${proposal.servings}">`,
    ...proposal.dishes.map((d) => `${d.role}: ${d.name}. ${d.idea}`),
    "עקרונות שהובטחו:",
    ...proposal.principles.map((p) => `- ${p.text}`),
    "</approved_proposal>",
  ].join("\n");
}

async function buildDish(history: Anthropic.Beta.Messages.BetaMessageParam[], proposal: ChefProposal, index: number) {
  const dish = proposal.dishes[index]!;
  const response = await client.beta.messages
    .parse(
      request({
        max_tokens: 12000,
        system: [{ type: "text", text: BUILD_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [...history, { role: "user", content: `${approvedText(proposal)}\n\nכתוב עכשיו את המתכון המלא של: ${dish.name} (${dish.role}), ל-${proposal.servings} סועדים.` }],
        output_config: { effort: "medium", format: zodOutputFormat(DishSchema) },
      }),
    )
    .catch(explain);
  checkStop(response.stop_reason);
  if (!response.parsed_output) throw new Error(`לא הצלחתי לכתוב את "${dish.name}". נסו שוב.`);
  return { recipe: normalizeRecipeContent(response.parsed_output.recipe), why: cleanNotes(response.parsed_output.why, 4) };
}

async function buildTimeline(dishes: ChefBuilt["dishes"]): Promise<ChefBuilt["timeline"]> {
  const meal = dishes
    .map(
      (d) =>
        `<recipe title="${d.recipe.title}" prep_minutes="${d.recipe.prep_minutes ?? "?"}" cook_minutes="${d.recipe.cook_minutes ?? "?"}">\n${d.recipe.steps
          .map((s, i) => `${i + 1}. ${s.text}${s.duration_seconds ? ` (${Math.round(s.duration_seconds / 60)} דק׳)` : ""}`)
          .join("\n")}\n</recipe>`,
    )
    .join("\n\n");
  const response = await client.beta.messages
    .parse(
      request({
        max_tokens: 4000,
        system: TIMELINE_SYSTEM,
        messages: [{ role: "user", content: meal }],
        output_config: { effort: "low", format: zodOutputFormat(TimelineSchema) },
      }),
    )
    .catch(explain);
  checkStop(response.stop_reason);
  return (response.parsed_output?.timeline ?? []).slice(0, 12).map((t) => ({ when: t.when.trim(), text: t.text.trim() }));
}

export async function chefBuild(history: ChatMessage[], proposal: ChefProposal): Promise<ChefBuilt> {
  const messages = toMessages(history);
  const dishes = await Promise.all(proposal.dishes.slice(0, 4).map((_, i) => buildDish(messages, proposal, i)));
  // A single dish is its own working order; a meal gets one. A failed timeline does not lose the recipes.
  const timeline = dishes.length > 1 ? await buildTimeline(dishes).catch(() => []) : [];
  return { dishes, timeline };
}
