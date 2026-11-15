import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { q } from "./db.js";
import { env } from "./env.js";

const client = new Anthropic();

const Out = z.object({
  items: z.array(
    z.object({
      id: z.string().describe("the recipe id exactly as given"),
      servings: z.number().describe("how many people the amounts feed; a whole number from 1 to 24"),
    }),
  ),
});

/**
 * Recipes imported before servings were required (2026-11-15) have none, so
 * the servings calculator could not start from anything. One model call per
 * 20 recipes estimates the number from the title and the ingredient amounts;
 * the result is saved on the recipe and the cook can correct it from the pill.
 * Runs on boot; a recipe with a number is never touched again.
 */
export async function backfillServings(): Promise<void> {
  const rows = await q<{ id: string; title: string; ingredients: { name: string; quantity: number | null; unit: string | null }[] }>(
    "select id, title, ingredients from recipes where servings is null order by created_at desc limit 200",
  );
  if (!rows.length) return;
  console.log(`[servings] estimating servings for ${rows.length} recipe(s)`);
  let done = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const text = chunk
      .map((r) => {
        const lines = r.ingredients
          .map((x) => [x.quantity, x.unit, x.name].filter((v) => v !== null && v !== "").join(" "))
          .join("; ");
        return `<recipe id="${r.id}">\n${r.title}\n${lines}\n</recipe>`;
      })
      .join("\n");
    const response = await client.messages.parse({
      model: env.claudeModel,
      max_tokens: 2000,
      system:
        "You estimate how many servings a home recipe makes from its title and ingredient amounts (e.g. 500 g pasta ≈ 4-5 people, one whole chicken ≈ 4-6, a cake ≈ 8-12, a salad with 2 cucumbers ≈ 2-4). Return a whole number for every recipe id given, nothing else. When unsure, say 4.",
      messages: [{ role: "user", content: text }],
      output_config: { format: zodOutputFormat(Out) },
    });
    for (const item of response.parsed_output?.items ?? []) {
      const n = Math.min(24, Math.max(1, Math.round(item.servings)));
      if (!chunk.some((r) => r.id === item.id)) continue;
      await q("update recipes set servings = $1 where id = $2 and servings is null", [n, item.id]);
      done += 1;
    }
  }
  console.log(`[servings] saved an estimate on ${done} recipe(s)`);
}
