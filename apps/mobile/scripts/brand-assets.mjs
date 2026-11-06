// Copies the approved logo from kort-assets/ into the app and builds the home-screen
// icons from the bird symbol: the bird large on the app's cream background.
// Run from the repo root:  node apps/mobile/scripts/brand-assets.mjs
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../../..");
const src = path.join(root, "kort-assets");
const brand = path.join(root, "apps/mobile/assets/brand");
const images = path.join(root, "apps/mobile/assets/images");
const pub = path.join(root, "apps/mobile/public");
const CREAM = "#F9F2E6"; // the app background
const bird = path.join(src, "symbol/kort-bird-512.png");

await Promise.all([brand, images, pub].map((d) => mkdir(d, { recursive: true })));

// Logo for the home header
await copyFile(path.join(src, "logo/kort-logo-640.png"), path.join(brand, "kort-logo.png"));
await copyFile(bird, path.join(brand, "kort-bird.png"));
await copyFile(path.join(src, "logo/kort-logo-640.png"), path.join(pub, "logo.png")); // public: used in the daily email

/** A square icon: the bird scaled to `fill` of the side, centred, on cream (or transparent). */
async function icon(side, fill, background = CREAM) {
  const inner = Math.round(side * fill);
  const sprite = await sharp(bird)
    .trim() // the source has empty space under the bowl; centre the drawing itself
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const bg = background === "transparent" ? { r: 0, g: 0, b: 0, alpha: 0 } : background;
  return sharp({ create: { width: side, height: side, channels: 4, background: bg } })
    .composite([{ input: sprite, gravity: "centre" }])
    .png();
}

// Home-screen icons (the OS rounds the corners): bird fills ~84% of the square.
const FULL = 0.84;
await (await icon(1024, FULL)).toFile(path.join(images, "icon.png"));
await (await icon(1024, FULL)).toFile(path.join(pub, "icon.png"));
await (await icon(512, FULL)).toFile(path.join(pub, "icon-512.png"));
await (await icon(192, FULL)).toFile(path.join(pub, "icon-192.png"));
await (await icon(180, FULL)).toFile(path.join(pub, "apple-touch-icon.png"));
// Android masks (circle/squircle) keep only the inner 80%: the bird sits a bit smaller there.
await (await icon(512, 0.62)).toFile(path.join(pub, "icon-maskable-512.png"));
// Android adaptive icon layers: foreground on transparent (safe zone 66%), flat cream background, monochrome.
await (await icon(1024, 0.6, "transparent")).toFile(path.join(images, "android-icon-foreground.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: CREAM } }).png().toFile(path.join(images, "android-icon-background.png"));
const fg = await (await icon(1024, 0.6, "transparent")).toBuffer();
const alpha = await sharp(fg).extractChannel("alpha").toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#000000" } })
  .joinChannel(alpha)
  .png()
  .toFile(path.join(images, "android-icon-monochrome.png"));
// Splash: the bird on transparent (Expo puts it on the cream background).
await (await icon(512, 0.8, "transparent")).toFile(path.join(images, "splash-icon.png"));
// Browser-tab favicons: the same bird, small.
await (await icon(128, 0.9)).toFile(path.join(images, "favicon.png"));
await (await icon(32, 0.95)).toFile(path.join(pub, "favicon-32.png"));
await (await icon(16, 1)).toFile(path.join(pub, "favicon-16.png"));

console.log("logo + bird icons installed");
