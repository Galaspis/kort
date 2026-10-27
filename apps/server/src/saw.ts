import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "./env.js";
import { fetchSource } from "./import/source.js";
import { saveMedia } from "./storage.js";

/**
 * Saw: the woodworking link-saver that lives at woody.gallab.top/saw.
 * It reuses Kort's fetcher (ScrapeCreators for Facebook/Instagram, yt-dlp for the
 * rest, HTML as a fallback) but never keeps the video: only the caption, a thumbnail
 * copy and a short Hebrew summary go back to the page, which stores them in the hub
 * document store. Nothing is written to Kort's database.
 */

const client = new Anthropic();

export const SAW_TYPES = ["project", "technique", "tool", "material", "inspiration"] as const;

const SawSchema = z.object({
  title: z.string().describe("כותרת קצרה בעברית (עד 60 תווים) שמתארת את הפרויקט או הטכניקה"),
  summary: z.string().describe("2-3 משפטים בעברית: מה רואים, מה לומדים, למה זה שימושי לנגר חובב"),
  type: z.string().describe(`אחד בדיוק מ: ${SAW_TYPES.join(" | ")}. project = משהו לבנות, technique = שיטת עבודה, tool = כלי או ג'יג, material = חומר/גימור, inspiration = רעיון בלבד`),
  tags: z.array(z.string()).describe("עד 6 תגיות קצרות בעברית (למשל: חיבורים, גימור, ג'יג, שולחן, אחסון, מתחילים)"),
  materials: z.array(z.string()).describe("חומרים שמוזכרים או נראים, בעברית, רשימה קצרה. ריק אם אין"),
  tools: z.array(z.string()).describe("כלים שמוזכרים או נראים, בעברית, רשימה קצרה. ריק אם אין"),
  difficulty: z.string().describe("אחד בדיוק מ: קל | בינוני | מתקדם | לא ידוע"),
  key_points: z.array(z.string()).describe("עד 5 נקודות קצרות בעברית שכדאי לזכור (מידות, טיפים, סדר פעולות). ריק אם אין"),
});
export type SawContent = z.infer<typeof SawSchema>;

const SYSTEM_PROMPT = `You are the note-taker of a personal woodworking library. The user saves posts from Instagram, Facebook, YouTube, TikTok or blogs about woodworking: projects to build, techniques, jigs, tools, finishes, shop ideas. You receive whatever could be gathered from the post: caption, title, author, speech transcript, page text. Turn it into one short, useful library card.

Rules:
- Everything the user reads (title, summary, tags, materials, tools, key points) is natural, fluent, everyday Hebrew of the kind an Israeli hobby woodworker uses. Translate from any language. Keep brand names and product names recognizable (e.g. "Festool", "Kreg", "אפוקסי").
- Never invent or guess Hebrew words. Use the common term (שעם = cork, חומר מרוכב = composite, דיקט = plywood, MDF stays MDF, עץ אורן, עץ אלון, סנדפפר/נייר לטש, מקדחה, מסור עגול, מסור שולחני, נתב/ראוטר, מלחציים, דבק עץ). When a material or tool has no common Hebrew name, write the English word in Latin letters in brackets, e.g. "בלוק ליטוש (sanding block)". A reader must never meet a word that does not exist in Hebrew.
- Be concrete: a summary that says what is being built or shown and what the useful takeaway is. No marketing, no hashtags, no emojis, no "follow for more".
- Never invent dimensions, materials or steps that the source does not support. When the source is thin, keep the lists empty and the summary honest about what is visible.
- type must be exactly one of the allowed values. difficulty must be exactly one of the allowed values.
- If the source is not about woodworking at all, still return the schema with a best-effort title and summary, type "inspiration", and a tag "לא נגרות".`;

export interface SawResult extends SawContent {
  url: string;
  platform: string;
  author: string | null;
  caption: string | null;
  /** Our own copy of the post's thumbnail, served from Kort's media folder (social thumbnails expire). */
  thumbnail_url: string | null;
  duration_seconds: number | null;
  fetch_error: string | null;
}

export async function enrichSawLink(url: string, userText: string | null): Promise<SawResult> {
  const workDir = path.resolve(env.tmpDir, "saw-" + createHash("sha1").update(url + Date.now()).digest("hex").slice(0, 12));
  try {
    const source = await fetchSource(url, workDir, { download: false });
    const hasAnything = Boolean(source.caption) || Boolean(source.pageText) || Boolean(source.transcript) || Boolean(source.title) || Boolean(userText);
    if (!hasAnything) {
      const social = source.platform === "facebook" || source.platform === "instagram";
      const name = source.platform === "facebook" ? "פייסבוק" : source.platform === "instagram" ? "אינסטגרם" : "האתר";
      throw new Error(
        social
          ? `${name} חסם את הקריאה של הפוסט מהשרת (${source.fetchError ?? "no content"}). אפשר לשמור את הקישור בלי תקציר, או להדביק את הכיתוב של הפוסט.`
          : `לא הצלחתי לקרוא תוכן מהקישור (${source.fetchError ?? "no content"}). אפשר לשמור את הקישור בלי תקציר.`,
      );
    }

    const sections: string[] = [`<source platform="${source.platform}" url="${url}">`];
    if (source.title) sections.push(`<title>\n${source.title}\n</title>`);
    if (source.author) sections.push(`<author>${source.author}</author>`);
    if (source.caption) sections.push(`<caption>\n${source.caption}\n</caption>`);
    if (source.transcript) sections.push(`<speech_transcript>\n${source.transcript}\n</speech_transcript>`);
    if (source.pageText) sections.push(`<page_text>\n${source.pageText.slice(0, 12_000)}\n</page_text>`);
    if (userText) sections.push(`<user_pasted_text>\n${userText}\n</user_pasted_text>`);
    sections.push("</source>");

    const response = await client.messages
      .parse({
        model: env.claudeModel,
        max_tokens: 2000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: sections.join("\n\n") }],
        output_config: { format: zodOutputFormat(SawSchema) },
      })
      .catch((err: unknown) => {
        if (err instanceof Anthropic.APIError) throw new Error(`שגיאה מול Claude (${err.status}): ${err.message}`);
        throw new Error("המודל החזיר תשובה בפורמט לא תקין. נסו שוב.");
      });
    if (!response.parsed_output) throw new Error("לא הצלחתי לסכם את הפוסט");
    const content = normalize(response.parsed_output);

    const thumbnail_url = source.thumbnailUrl ? await storeThumbnail(source.thumbnailUrl, url) : null;
    return {
      ...content,
      url,
      platform: source.platform,
      author: source.author,
      caption: source.caption,
      thumbnail_url,
      duration_seconds: source.durationSeconds,
      fetch_error: source.fetchError,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalize(c: SawContent): SawContent {
  const type = (SAW_TYPES as readonly string[]).includes(c.type) ? c.type : "inspiration";
  const difficulty = ["קל", "בינוני", "מתקדם"].includes(c.difficulty) ? c.difficulty : "לא ידוע";
  const clean = (arr: string[], max: number) => arr.map((s) => s.trim()).filter(Boolean).slice(0, max);
  return {
    title: c.title.trim().slice(0, 80),
    summary: c.summary.trim(),
    type,
    tags: clean(c.tags, 6),
    materials: clean(c.materials, 12),
    tools: clean(c.tools, 12),
    difficulty,
    key_points: clean(c.key_points, 5),
  };
}

/** Social thumbnails are signed URLs that expire in hours; keep a copy named after the link. */
async function storeThumbnail(thumbnailUrl: string, sourceUrl: string): Promise<string | null> {
  try {
    const res = await fetch(thumbnailUrl, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) return null;
    const id = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16);
    return await saveMedia("saw-images", `${id}.${ext}`, bytes);
  } catch (err) {
    console.warn("[saw] thumbnail fetch failed", (err as Error).message);
    return null;
  }
}
