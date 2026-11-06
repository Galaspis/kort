// After `expo export`, rename index.html so the server can inject config into it,
// and copy the PWA files Expo doesn't know about.
import { copyFile, rename } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "../../server/public");
await rename(path.join(out, "index.html"), path.join(out, "app.html"));
for (const f of ["manifest.json", "sw.js", "icon.png", "icon-512.png", "icon-192.png", "icon-maskable-512.png", "apple-touch-icon.png", "logo.png", "favicon-32.png", "favicon-16.png"]) {
  await copyFile(path.resolve(import.meta.dirname, "../public", f), path.join(out, f)).catch(() => undefined);
}
console.log("web build ready in apps/server/public");
