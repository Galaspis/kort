import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

export type Bucket = "recipe-images" | "recipe-videos" | "saw-images";

function safe(objectPath: string) {
  const clean = objectPath.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/");
  if (!clean) throw new Error("bad media path");
  return clean;
}

/** Writes a file under MEDIA_DIR/<bucket>/<path> and returns the URL it is served from. */
export async function saveMedia(bucket: Bucket, objectPath: string, bytes: Uint8Array | Buffer): Promise<string> {
  const rel = safe(objectPath);
  const full = path.join(env.mediaDir, bucket, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return `${env.mediaBaseUrl}/${bucket}/${rel}`;
}

export const mediaRoot = env.mediaDir;
