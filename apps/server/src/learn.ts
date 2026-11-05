import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LESSONS, type WhyNote } from "@recipe/shared";
import { z } from "zod";
import { env } from "./env.js";

/**
 * "למה זה עובד?": three to five short Hebrew notes about the science behind one
 * recipe, each tied to a lesson of the course when one fits. Written once and
 * cached on the recipe row.
 */
const client = new Anthropic();

const Out = z.object({
  notes: z.array(
    z.object({
      text: z.string().describe("הערה קצרה בעברית, משפט או שניים, על מה קורה כאן ולמה"),
      lesson_id: z.string().nullable().describe("מזהה השיעור המתאים ביותר מהרשימה, או null"),
    }),
  ),
});

const LESSON_LIST = LESSONS.map((l) => `${l.id}: ${l.title} (${l.subtitle})`).join("\n");

const SYSTEM = `You explain the food science behind a specific home recipe, in plain Hebrew, for a curious home cook who is following a short cooking course. Given a recipe, write 3 to 5 notes. Each note is about THIS dish: one concrete thing the cook does (or should do) and the reason it works, for example when the salt goes in and why, what the browning step gives, why the meat rests, why the acid is added at the end, why the garlic goes in after the onion, what the pasta water does. Prefer notes that change what the cook will do at the stove. Everyday Hebrew, no jargon unless explained in the same sentence, no emojis, one or two sentences per note. Do not repeat the recipe steps; explain them. If a note matches one of these course lessons, set lesson_id to that id, otherwise null:\n${LESSON_LIST}`;

export async function explainRecipe(recipe: {
  title: string;
  category: string;
  ingredients: { name: string; quantity: number | null; unit: string | null }[];
  steps: { text: string }[];
}): Promise<WhyNote[]> {
  const ingredients = recipe.ingredients
    .map((i) => [i.quantity, i.unit, i.name].filter((x) => x !== null && x !== "").join(" "))
    .join("\n");
  const steps = recipe.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  const response = await client.messages.parse({
    model: env.claudeModel,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `<recipe title="${recipe.title}" category="${recipe.category}">\n<ingredients>\n${ingredients}\n</ingredients>\n<steps>\n${steps}\n</steps>\n</recipe>` }],
    output_config: { format: zodOutputFormat(Out) },
  });
  if (!response.parsed_output) throw new Error("לא הצלחתי להסביר את המתכון הזה");
  const known = new Set(LESSONS.map((l) => l.id));
  return response.parsed_output.notes.slice(0, 5).map((n) => ({
    text: n.text.trim(),
    lesson_id: n.lesson_id && known.has(n.lesson_id) ? n.lesson_id : null,
  }));
}
