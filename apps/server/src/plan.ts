import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { COURSES, MEALS, courseOf, mealOf } from "@recipe/shared";
import { z } from "zod";
import { env } from "./env.js";

/**
 * "תציע לי": picks up to three of the family's own recipes for a slot in the
 * plan, with one line of reasoning each, and optionally one new idea.
 */
const client = new Anthropic();

const Out = z.object({
  picks: z
    .array(
      z.object({
        recipe_id: z.string().describe("id של מתכון מהרשימה, בדיוק כפי שניתן"),
        reason: z.string().describe("משפט אחד בעברית: למה זה מתאים לסלוט הזה"),
      }),
    )
    .max(3),
  new_idea: z
    .object({
      title: z.string().describe("שם מנה קצר בעברית"),
      description: z.string().describe("משפט או שניים: מה זה ולמה מתאים"),
    })
    .nullable()
    .describe("רעיון אחד שאין עדיין במתכונים של המשפחה, או null"),
});

const SYSTEM = `You help a family in Israel plan meals from their own recipe collection. You get the slot (date, weekday, meal such as dinner or Friday evening, and the course such as salad, main or dessert), what is already planned that week, an optional hint from the cook, and the list of their recipes with category, tags, time, rating, whether the kids liked it and how often it was cooked. Pick up to three recipes that fit the course and the occasion: a dessert slot gets desserts, a Friday-evening main can be more festive, a weekday dinner should be quick unless the hint says otherwise. Prefer liked and kid-approved recipes, avoid repeating something already planned that week, and vary categories. If fewer than three fit well, return fewer. Reasons are one short plain-Hebrew sentence each. Separately, suggest one new idea that is not in their collection and matches the slot and hint (or null if the collection covers it well). Use recipe ids exactly as given.`;

export interface SuggestInput {
  date: string;
  meal: string;
  course: string;
  hint: string | null;
  planned: string[];
  recipes: {
    id: string;
    title: string;
    category: string;
    tags: string[];
    minutes: number | null;
    rating: number | null;
    kids_approved: boolean | null;
    times_cooked: number;
  }[];
}

export async function suggestForSlot(input: SuggestInput) {
  const weekday = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][new Date(input.date + "T12:00:00").getDay()];
  const list = input.recipes
    .map(
      (r) =>
        `${r.id} | ${r.title} | ${r.category} | ${r.tags.join(", ")} | ${r.minutes ? `${r.minutes} דק׳` : "?"} | דירוג ${r.rating ?? "-"} | ילדים ${r.kids_approved === true ? "כן" : r.kids_approved === false ? "לא" : "?"} | בושל ${r.times_cooked}`,
    )
    .join("\n");
  const content = [
    `<slot date="${input.date}" weekday="${weekday}" meal="${mealOf(input.meal).label}" course="${courseOf(input.course).label}" />`,
    input.hint ? `<hint>${input.hint}</hint>` : "",
    input.planned.length ? `<already_planned_this_week>\n${input.planned.join("\n")}\n</already_planned_this_week>` : "",
    `<recipes format="id | title | category | tags | time | rating | kids | cooked">\n${list}\n</recipes>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const response = await client.messages.parse({
    model: env.claudeModel,
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(Out) },
  });
  if (!response.parsed_output) throw new Error("לא הצלחתי להציע הפעם");
  const known = new Set(input.recipes.map((r) => r.id));
  return {
    picks: response.parsed_output.picks.filter((p) => known.has(p.recipe_id)),
    new_idea: response.parsed_output.new_idea,
  };
}

export const MEAL_IDS = MEALS.map((m) => m.id);
export const COURSE_IDS = COURSES.map((c) => c.id);
