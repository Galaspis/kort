import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  NutritionSchema,
  RecipeAISchema,
  normalizeRecipeContent,
  type RecipeContent,
} from "@recipe/shared";
import { env } from "../env.js";
import type { Frame } from "./media.js";

const client = new Anthropic();

/**
 * Frozen system prompt. Keep it byte-stable so prompt caching keeps hitting:
 * anything request-specific goes into the user turn instead.
 */
const SYSTEM_PROMPT = `You are the recipe engine of a family cooking app. Users share a link from Instagram, Facebook, TikTok, a blog, or they paste text. You receive whatever could be gathered from that source: caption text, a speech transcript, frames sampled from the video (often with on-screen ingredient lists), page text, and metadata. Your job is to turn it into one clean, complete, structured recipe.

Output rules:
- Everything the user will read (title, description, ingredient names, units, notes, steps, tags, cuisine, warnings) is written in natural, fluent Hebrew. Translate from any source language. Keep brand names and proper nouns recognizable (e.g. "פרמזן", "סריראצ'ה").
- Prefer units a home cook in Israel uses: כוס, כף, כפית, גרם, ק"ג, מ"ל, ליטר, יחידה, חבילה, קופסה, שן (שום), פרוסה, צרור. Convert imperial units when the source uses them (1 cup ≈ 240 מ"ל, 1 oz ≈ 28 גרם, 1 lb ≈ 450 גרם, °F → °C rounded to a sensible oven setting).
- Quantities are numbers: write 0.5 not "חצי", 1.5 not "אחד וחצי". A range ("2-3 כפות") becomes the lower bound with the range in note. "לפי הטעם" / "קמצוץ" → quantity null, unit null, note holds the phrase.
- Steps are short imperative sentences, one action each, in cooking order. Merge duplicate instructions that appear in both caption and speech. Put oven temperatures and times inside the step text and also fill duration_seconds for any waiting, baking, simmering, resting or chilling time.
- Reconcile sources carefully: on-screen text and speech usually carry the exact amounts; captions sometimes omit them. If sources conflict, prefer the most specific one and mention the conflict in warnings.
- Never invent quantities or steps that are not supported by the source. When something is clearly missing, leave it null, set confidence to "medium" or "low", and explain in warnings (in Hebrew) what the user should check. Warnings are for real gaps only; an empty list is the normal case.
- If the source is not a recipe at all, still return the schema with the best title you can, empty ingredients and steps, confidence "low", and a warning that says no recipe was found.
- category must be one of the allowed Hebrew categories; pick the closest. A main course is filed by its main ingredient: chicken or turkey → עוף, beef/lamb/ground meat → בשר, fish and seafood → דגים, pasta/noodles/lasagna → פסטה; "מנה עיקרית" is only for other mains (vegetarian, legumes, shakshuka). tags: up to 6 short Hebrew tags that help a family find the dish later (diet, occasion, speed, main ingredient, kid-friendly). aisle for each ingredient must be one of the allowed supermarket sections.
- Do not include hashtags, emojis, creator self-promotion, or "follow for more" text anywhere.
- nutrition: estimate calories, protein, carbs and fat for ONE serving from the ingredient amounts (divide the total by servings; assume 4 servings if unknown). Round to whole numbers. It is an estimate, not a lab value.`;

export interface ExtractInput {
  sourceUrl: string | null;
  platform: string;
  title: string | null;
  author: string | null;
  caption: string | null;
  transcript: string | null;
  pageText: string | null;
  userText: string | null;
  frames: Frame[];
}

export async function extractRecipe(input: ExtractInput): Promise<RecipeContent> {
  const content: Anthropic.ContentBlockParam[] = [];

  const sections: string[] = [];
  sections.push(`<source platform="${input.platform}"${input.sourceUrl ? ` url="${input.sourceUrl}"` : ""}>`);
  if (input.title) sections.push(`<title>\n${input.title}\n</title>`);
  if (input.author) sections.push(`<author>${input.author}</author>`);
  if (input.caption) sections.push(`<caption>\n${input.caption}\n</caption>`);
  if (input.transcript) sections.push(`<speech_transcript>\n${input.transcript}\n</speech_transcript>`);
  if (input.pageText) sections.push(`<page_text>\n${input.pageText}\n</page_text>`);
  if (input.userText) sections.push(`<user_pasted_text>\n${input.userText}\n</user_pasted_text>`);
  sections.push("</source>");
  content.push({ type: "text", text: sections.join("\n\n") });

  if (input.frames.length > 0) {
    content.push({
      type: "text",
      text: `Below are ${input.frames.length} frames sampled from the video in chronological order. Read any on-screen text (ingredient lists, amounts, temperatures) and use what you can see being cooked to fill gaps in the caption.`,
    });
    for (const frame of input.frames) {
      content.push({ type: "text", text: `Frame at ${frame.atSeconds}s:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: frame.base64 },
      });
    }
  }

  content.push({
    type: "text",
    text: "Produce the structured recipe now. Hebrew for every user-facing string.",
  });

  const response = await parseOrExplain({ role: "user", content });
  return normalizeRecipeContent(response);
}

/**
 * For recipes the user typed by hand: keeps their words, fills in the smart
 * parts (category, tags, aisles, step timers, cleaned-up ingredient parsing).
 */
export async function enrichManualRecipe(draft: {
  title: string;
  description: string | null;
  servings: number | null;
  ingredientsText: string;
  stepsText: string;
}): Promise<RecipeContent> {
  const text = [
    "The user typed this recipe by hand. Keep their wording and quantities; do not translate or rewrite their steps beyond light cleanup. Parse each ingredient line into name/quantity/unit/note, assign aisles, fill duration_seconds where a step states a time, and choose category, cuisine, difficulty and tags.",
    `<title>${draft.title}</title>`,
    draft.description ? `<description>${draft.description}</description>` : "",
    draft.servings ? `<servings>${draft.servings}</servings>` : "",
    `<ingredients>\n${draft.ingredientsText}\n</ingredients>`,
    `<steps>\n${draft.stepsText}\n</steps>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await parseOrExplain({ role: "user", content: text });
  return normalizeRecipeContent(response);
}

/** One Claude call with the loose schema; turns SDK/validation failures into Hebrew errors the app can show. */
async function parseOrExplain(message: Anthropic.MessageParam) {
  const response = await client.messages
    .parse({
      model: env.claudeModel,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [message],
      output_config: { format: zodOutputFormat(RecipeAISchema) },
    })
    .catch((err: unknown) => {
      if (err instanceof Anthropic.APIError) {
        throw new Error(`שגיאה מול Claude (${err.status}): ${err.message}`);
      }
      console.error("[extract] structured output failed", err);
      throw new Error("המודל החזיר מתכון בפורמט לא תקין. נסו שוב או הדביקו את הטקסט ידנית.");
    });
  if (response.stop_reason === "refusal") throw new Error("המודל סירב לעבד את התוכן הזה");
  if (response.stop_reason === "max_tokens") throw new Error("המתכון ארוך מדי לעיבוד בבת אחת");
  if (!response.parsed_output) throw new Error("לא הצלחתי להבין את המתכון מהמקור");
  return response.parsed_output;
}

/** Nutrition estimate for a recipe that was saved before nutrition existed. */
export async function estimateNutrition(recipe: {
  title: string;
  servings: number | null;
  ingredients: { name: string; quantity: number | null; unit: string | null }[];
}) {
  const lines = recipe.ingredients
    .map((i) => [i.quantity, i.unit, i.name].filter((x) => x !== null && x !== "").join(" "))
    .join("\n");
  const response = await client.messages.parse({
    model: env.claudeModel,
    max_tokens: 2000,
    system:
      "You are a nutrition estimator for a home cooking app. Given the ingredient list and number of servings, estimate calories, protein, carbs and fat for ONE serving. Use standard food composition values, assume typical preparation, divide totals by servings (assume 4 if unknown), round to whole numbers.",
    messages: [
      {
        role: "user",
        content: `Recipe: ${recipe.title}\nServings: ${recipe.servings ?? "unknown"}\nIngredients:\n${lines}`,
      },
    ],
    output_config: { format: zodOutputFormat(NutritionSchema) },
  });
  if (!response.parsed_output) throw new Error("לא הצלחתי להעריך ערכים תזונתיים");
  return response.parsed_output;
}
