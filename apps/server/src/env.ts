import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * yt-dlp saves cookies back to the file when it exits. The mounted secret is
 * read-only, which made every run end with a traceback (and a non-zero exit)
 * even after it had fetched the post. Work from a writable copy instead.
 */
function writableCookies(source: string | null, tmpDir: string): string | null {
  if (!source) return null;
  try {
    mkdirSync(tmpDir, { recursive: true });
    const copy = path.join(tmpDir, "cookies.txt");
    copyFileSync(source, copy);
    return copy;
  } catch (err) {
    console.warn("[cookies] could not copy cookies file:", (err as Error).message);
    return source;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  /** Postgres on the gallab server (or a local one in development). */
  databaseUrl: required("DATABASE_URL"),
  /** Where images and videos are kept, and the public base URL they are served from. */
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? "media"),
  mediaBaseUrl: (process.env.MEDIA_BASE_URL ?? "/media").replace(/\/$/, ""),
  /** Where Kort is reached from other gallab sites (Saw shows thumbnails from here). */
  publicUrl: (process.env.KORT_PUBLIC_URL ?? "https://kort.gallab.top").replace(/\/$/, ""),
  /**
   * HUB_AUTH=1: the app sits behind the gallab login (Caddy + Tinyauth), which sets
   * Remote-Email on every request. Locally, DEV_USER_EMAIL plays that role.
   */
  hubAuth: process.env.HUB_AUTH === "1",
  devUserEmail: process.env.DEV_USER_EMAIL || null,
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  ytdlpPath: process.env.YTDLP_PATH || "yt-dlp",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  scrapeCreatorsKey: process.env.SCRAPECREATORS_API_KEY || null,
  unsplashKey: process.env.UNSPLASH_ACCESS_KEY || null,
  cookiesFile: writableCookies(process.env.COOKIES_FILE || null, process.env.TMP_DIR || "tmp"),
  tmpDir: process.env.TMP_DIR || "tmp",
};
