import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  LESSONS,
  RecipeAISchema,
  deepLesson,
  normalizeRecipeContent,
  type Lesson,
  type RecipeContent,
  type WhyNote,
} from "@recipe/shared";
import { z } from "zod";
import { env } from "./env.js";

/**
 * The cooking coach: the two places where the cook talks with the model.
 *   askLesson  - a question while learning a lesson ("why not olive oil?").
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

const VOICE = `Write in plain everyday Hebrew, warm and direct, like a friend who cooks well. No markdown, no bullet symbols, no emojis, no headings: short paragraphs only. Explain any technical word in the same sentence. Temperatures in Celsius, metric quantities. Never invent facts: if something depends on the cut, the pan or the oven, say what it depends on. Food safety comes first (poultry and minced meat cooked through, no risky shortcuts). When a course lesson covers the point, mention it by number and name, for example "(שיעור 5, השחמה)".`;

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

const ASK_SYSTEM = `You are Kort, the cooking teacher inside a family's recipe app. The cook is in the middle of a lesson of the app's cooking course and asks you a question. Answer the question that was asked, in two to five sentences: first the direct answer, then the reason (what physically or chemically happens), then, if it helps, one thing to do differently at the stove tonight. If the question is outside the lesson, answer it anyway, briefly. If the cook describes a result that went wrong, diagnose it: name the most likely cause first and how to check it. Do not repeat the lesson back; add to it. If you are not sure, say so.

${VOICE}

${FOUNDATIONS}

All lessons of the course (id | number and title | topics):
${LESSON_INDEX}`;

export async function askLesson(lesson: Lesson | null, history: ChatMessage[]): Promise<string> {
  const messages = toMessages(history);
  if (!messages.length) throw new Error("חסרה שאלה");
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }];
  if (lesson) system.push({ type: "text", text: `The lesson the cook is in right now:\n${lessonText(lesson)}` });
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
  return text;
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
