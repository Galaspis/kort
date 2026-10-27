import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { detectPlatform, type SourcePlatform } from "@recipe/shared";
import { env } from "../env.js";
import { run } from "./shell.js";
import { fetchViaVendor } from "./vendor.js";

export interface FetchedSource {
  platform: SourcePlatform;
  url: string;
  title: string | null;
  caption: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** Local path of the downloaded video, when one exists. */
  videoPath: string | null;
  /** Readable page text for plain web pages (blogs). */
  pageText: string | null;
  /** Why the downloader could not read the post, when it couldn't. */
  fetchError: string | null;
  /** Speech transcript when the source already provides one. */
  transcript?: string | null;
}

const MAX_VIDEO_SECONDS = 15 * 60;

function ytdlpBaseArgs(): string[] {
  const args = ["--no-playlist", "--no-warnings", "--socket-timeout", "30"];
  if (env.cookiesFile) args.push("--cookies", env.cookiesFile);
  return args;
}

/**
 * Pulls caption, metadata and (for short videos) the video file itself.
 * Strategy: yt-dlp first (covers Instagram, Facebook, TikTok, YouTube and
 * many others), then an HTML open-graph fallback for plain posts and blogs.
 */
export interface FetchOptions {
  /** false = metadata, caption and thumbnail only; never pull the video file (used by the Saw link-saver). */
  download?: boolean;
}

export async function fetchSource(url: string, workDir: string, opts: FetchOptions = {}): Promise<FetchedSource> {
  const download = opts.download !== false;
  await mkdir(workDir, { recursive: true });
  const platform = detectPlatform(url);

  // Blogs and recipe sites: the page itself is the source of truth. yt-dlp would
  // only find an embedded Instagram/YouTube player and return its caption instead.
  if (platform === "web") {
    const page = await fetchHtml(url, platform);
    if ((page.pageText?.length ?? 0) > 300 || page.caption) return page;
  }

  // Facebook / Instagram: the vendor is the stable path; yt-dlp and the HTML
  // page are fallbacks that work only sometimes from a data-centre address.
  let vendorError: string | null = null;
  if ((platform === "facebook" || platform === "instagram") && env.scrapeCreatorsKey) {
    try {
      return await fetchViaVendor(url, platform, workDir, download);
    } catch (err) {
      vendorError = (err as Error).message;
      console.warn("[vendor] failed, falling back:", vendorError);
    }
  }

  const viaYtdlp = await fetchWithYtdlp(url, platform, workDir, download);
  if ("platform" in viaYtdlp) return viaYtdlp;

  const html = await fetchHtml(url, platform);
  return { ...html, fetchError: [vendorError && `vendor: ${vendorError}`, viaYtdlp.error].filter(Boolean).join("; ") };
}

async function fetchWithYtdlp(
  url: string,
  platform: SourcePlatform,
  workDir: string,
  download: boolean,
): Promise<FetchedSource | { error: string }> {
  let meta: Record<string, unknown>;
  try {
    const probe = await run(env.ytdlpPath, [...ytdlpBaseArgs(), "--dump-single-json", "--skip-download", url], {
      timeoutMs: 90_000,
    });
    const parsed = parseProbe(probe.stdout);
    if (!parsed) {
      console.warn("[yt-dlp] metadata failed:", probe.stderr.slice(0, 500));
      return { error: summarizeYtdlpError(probe.stderr) };
    }
    if (probe.code !== 0) console.warn("[yt-dlp] exited", probe.code, "but returned metadata; continuing");
    meta = parsed;
  } catch (err) {
    console.warn("[yt-dlp] not available or crashed:", (err as Error).message);
    return { error: "yt-dlp is not installed" };
  }

  const duration = typeof meta.duration === "number" ? meta.duration : null;
  const source: FetchedSource = {
    platform,
    url,
    title: str(meta.title) ?? str(meta.fulltitle),
    caption: str(meta.description),
    author: str(meta.uploader) ?? str(meta.channel) ?? str(meta.uploader_id),
    thumbnailUrl: str(meta.thumbnail),
    durationSeconds: duration,
    videoPath: null,
    pageText: null,
    fetchError: null,
  };

  const looksLikeVideo = Boolean(meta.formats) || Boolean(meta.url) || duration !== null;
  if (download && looksLikeVideo && (duration === null || duration <= MAX_VIDEO_SECONDS)) {
    source.videoPath = await downloadVideo(url, workDir);
  }
  return source;
}

async function downloadVideo(url: string, workDir: string): Promise<string | null> {
  const outTemplate = path.join(workDir, "video.%(ext)s");
  const result = await run(
    env.ytdlpPath,
    [
      ...ytdlpBaseArgs(),
      // Small file is plenty for frame sampling and audio.
      "-f",
      "bv*[height<=720]+ba/b[height<=720]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      outTemplate,
      url,
    ],
    { timeoutMs: 180_000 },
  );
  const files = await readdir(workDir);
  const video = files.find((f) => f.startsWith("video."));
  if (!video) {
    console.warn("[yt-dlp] download failed:", result.stderr.slice(0, 500));
    return null;
  }
  const full = path.join(workDir, video);
  const info = await stat(full);
  return info.size > 0 ? full : null;
}

/** Open-graph + readable text fallback for posts without a video and for blogs. */
async function fetchHtml(url: string, platform: SourcePlatform): Promise<FetchedSource> {
  const res = await fetch(url, {
    headers: {
      // A desktop browser UA gets the full page from most blogs and public FB posts.
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "he-IL,he;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  const html = await res.text();

  const og = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1] ??
    null;

  const ldRecipe = extractJsonLdRecipe(html);
  const title = decode(og("og:title")) ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
  const caption = decode(og("og:description") ?? og("description"));
  const loginWall =
    (platform === "facebook" || platform === "instagram") &&
    (res.status >= 400 || /log in|login|sign up|התחבר|facebook|instagram/i.test(title ?? "") && !caption);
  if (loginWall) {
    return {
      platform,
      url,
      title: null,
      caption: null,
      author: null,
      thumbnailUrl: null,
      durationSeconds: null,
      videoPath: null,
      pageText: null,
      fetchError: "login wall",
    };
  }

  return {
    platform,
    url,
    title: ldRecipe?.name ?? title,
    caption,
    author: ldRecipe?.author ?? decode(og("author")),
    thumbnailUrl: og("og:image") ?? ldRecipe?.image ?? null,
    durationSeconds: null,
    videoPath: null,
    pageText: ldRecipe?.text ?? readableText(html),
    fetchError: null,
  };
}

/** yt-dlp prints the JSON before any shutdown error, so parse what we got. */
function parseProbe(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Turns yt-dlp's stderr into one short, user-relevant reason. */
function summarizeYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (/login|log in|cookies|sign in|not logged|rate.?limit|checkpoint|unsupported url|cannot parse data/.test(s))
    return "blocked: login required";
  if (/private|unavailable|not available|removed|404/.test(s)) return "unavailable";
  return stderr.trim().split("\n").pop()?.slice(0, 200) ?? "unknown";
}

interface LdRecipe {
  name: string | null;
  author: string | null;
  image: string | null;
  text: string;
}

/** Many recipe sites embed schema.org/Recipe JSON-LD. That beats scraping prose. */
function extractJsonLdRecipe(html: string): LdRecipe | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]!) as unknown;
      const found = findRecipeNode(parsed);
      if (found) {
        const image = Array.isArray(found.image) ? found.image[0] : found.image;
        return {
          name: str(found.name),
          author: str((found.author as Record<string, unknown> | undefined)?.name) ?? str(found.author),
          image: typeof image === "string" ? image : str((image as Record<string, unknown> | undefined)?.url),
          text: JSON.stringify(found, null, 1).slice(0, 20_000),
        };
      }
    } catch {
      // ignore malformed blocks
    }
  }
  return null;
}

function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipeNode(item);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return obj;
  if (obj["@graph"]) return findRecipeNode(obj["@graph"]);
  return null;
}

function readableText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(body)!.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, 30_000);
}

function decode(text: string | null): string | null {
  if (text === null) return null;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
