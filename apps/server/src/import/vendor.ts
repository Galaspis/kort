import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SourcePlatform } from "@recipe/shared";
import { env } from "../env.js";
import type { FetchedSource } from "./source.js";

/**
 * ScrapeCreators: one synchronous call turns a public Facebook/Instagram post
 * URL into caption + video + author (+ transcript on Facebook). Their job is to
 * keep this working when Meta changes things; ours is to fall back gracefully.
 */
const BASE = "https://api.scrapecreators.com";

export class VendorError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export async function fetchViaVendor(url: string, platform: SourcePlatform, workDir: string, keepVideo = true): Promise<FetchedSource> {
  if (!env.scrapeCreatorsKey) throw new VendorError("vendor key not configured");
  if (platform !== "facebook" && platform !== "instagram") throw new VendorError("platform not supported by vendor");

  const endpoint =
    platform === "facebook"
      ? `${BASE}/v1/facebook/post?get_transcript=true&url=${encodeURIComponent(url)}`
      : `${BASE}/v1/instagram/post?trim=true&url=${encodeURIComponent(url)}`;

  const res = await fetch(endpoint, {
    headers: { "x-api-key": env.scrapeCreatorsKey },
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.success === false) {
    const reason = str(body.error) ?? str(body.message) ?? `HTTP ${res.status}`;
    throw new VendorError(reason, res.status);
  }
  const credits = body.credits_remaining;
  if (typeof credits === "number" && credits < 25) console.warn(`[vendor] only ${credits} ScrapeCreators credits left`);

  const mapped = platform === "facebook" ? mapFacebook(body) : mapInstagram(body);
  const source: FetchedSource = {
    platform,
    url,
    title: mapped.title,
    caption: mapped.caption,
    author: mapped.author,
    thumbnailUrl: mapped.thumbnailUrl,
    durationSeconds: mapped.durationSeconds,
    videoPath: null,
    pageText: null,
    fetchError: null,
    transcript: mapped.transcript,
  };
  if (!source.caption && !mapped.videoUrl) throw new VendorError("vendor returned no caption and no video");

  if (keepVideo && mapped.videoUrl) {
    // CDN links expire within hours: download now while they are valid.
    source.videoPath = await download(mapped.videoUrl, workDir).catch((err) => {
      console.warn("[vendor] video download failed:", (err as Error).message);
      return null;
    });
  }
  return source;
}

interface Mapped {
  title: string | null;
  caption: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  videoUrl: string | null;
  transcript: string | null;
}

function mapFacebook(b: Record<string, unknown>): Mapped {
  const video = (b.video ?? {}) as Record<string, unknown>;
  const author = (b.author ?? {}) as Record<string, unknown>;
  const caption = str(b.description);
  return {
    title: caption ? firstLine(caption) : null,
    caption,
    author: str(author.name),
    thumbnailUrl: str(video.thumbnail) ?? str(b.image_url),
    durationSeconds: num(video.length_in_second),
    videoUrl: str(video.hd_url) ?? str(video.sd_url),
    transcript: transcriptText(b.transcript),
  };
}

function mapInstagram(b: Record<string, unknown>): Mapped {
  const data = (b.data ?? {}) as Record<string, unknown>;
  const m = (data.xdt_shortcode_media ?? data.shortcode_media ?? b.media ?? b) as Record<string, unknown>;
  const edges = ((m.edge_media_to_caption as Record<string, unknown> | undefined)?.edges ?? []) as Record<string, unknown>[];
  const captionNode = (edges[0]?.node ?? {}) as Record<string, unknown>;
  const owner = (m.owner ?? {}) as Record<string, unknown>;
  const caption = str(captionNode.text) ?? str(m.caption);
  return {
    title: caption ? firstLine(caption) : null,
    caption,
    author: str(owner.full_name) ?? str(owner.username),
    thumbnailUrl: str(m.thumbnail_src) ?? str(m.display_url),
    durationSeconds: num(m.video_duration),
    videoUrl: m.is_video === false ? null : str(m.video_url),
    transcript: transcriptText(b.transcript),
  };
}

/** Transcripts arrive as a string, as segments, or not at all. */
function transcriptText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const text = value
      .map((seg) => (typeof seg === "string" ? seg : str((seg as Record<string, unknown>)?.text) ?? ""))
      .join(" ")
      .trim();
    return text || null;
  }
  if (value && typeof value === "object") return transcriptText((value as Record<string, unknown>).text);
  return null;
}

async function download(videoUrl: string, workDir: string): Promise<string> {
  await mkdir(workDir, { recursive: true });
  const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`video download HTTP ${res.status}`);
  const file = path.join(workDir, "video.mp4");
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
  return file;
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? text.slice(0, 120);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
