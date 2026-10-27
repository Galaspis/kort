# Kort — recipe app

Share a reel from Instagram or a post from Facebook to Kort and get a clean Hebrew recipe: ingredients, steps, a shopping list and a cooking mode. Recipes can also be written by hand. Built for a family household: everyone who signs in sees the same recipes and shopping lists.

**Why:** recipes found on social media get lost in saved-posts folders. Kort turns the link into a structured recipe you can actually cook from, and keeps the original video next to it.

Live at https://kort.gallab.top (private instance, behind a shared Google sign-in).

```
apps/mobile      Expo (React Native) app for iOS + Android + web, Hebrew, RTL; the web build is an installable PWA
apps/server      Hono server: API, media, and the importer (yt-dlp + ffmpeg + Claude turn a link into a recipe)
apps/server/db   Postgres schema (households, users, recipes, shopping lists, import jobs)
packages/shared  Recipe schema (zod) and the grocery parser shared by both
deploy/          Docker Compose, Caddy site and deploy notes for the hosted instance
```

## How an import works

1. You tap **Share** on a reel/post and pick Kort. In the installed PWA the share goes through the manifest's `share_target` to `/import?url=…`; an iPhone Shortcut can open the same address. The import screen sends the link to the server.
2. The server pulls the caption, thumbnail and (for short videos) the video with `yt-dlp`, samples frames with `ffmpeg`, optionally transcribes the audio, and asks Claude for a structured Hebrew recipe (translated if needed, with aisles, tags, timers).
3. The recipe is saved to Postgres with the original link and the media on disk, so you can watch the video from inside the recipe.

## Saw (links for Woody)

`POST /api/saw/enrich { url, text? }` reuses the same fetcher (ScrapeCreators for Facebook/Instagram, yt-dlp, HTML fallback) but with `download: false`: no video, no database row. It returns caption, author, a thumbnail copy under `media/saw-images/` (served as `KORT_PUBLIC_URL/media/...`) and a short Hebrew woodworking summary (`apps/server/src/saw.ts`). Woody's Caddy site proxies `woody.gallab.top/api/saw/*` here, so the caller is the same family login.

## Identity

There is no sign-up. The hosted instance sits behind a reverse proxy with Google sign-in, which sets a `Remote-Email` header on every request; the server maps that email to a user in the household (`HUB_AUTH=1`). Locally, leave `HUB_AUTH` unset and put your own address in `DEV_USER_EMAIL`.

## Stack

- **App:** Expo 57 / React Native 0.86 / React 19, Expo Router, TanStack Query; one codebase for web (PWA), iOS and Android.
- **Server:** Node + Hono, Postgres 17, `zod` schemas shared with the app.
- **Importer:** yt-dlp + ffmpeg for media, Claude for the recipe, optional Whisper transcription.
- **Hosting:** Docker Compose + Caddy on a small VPS, deployed by a GitHub Action.

## One-time setup

### 1. Postgres

Any Postgres 15+ works. For local development:

```bash
docker run -d --name kort-db -e POSTGRES_USER=kort -e POSTGRES_PASSWORD=kort -e POSTGRES_DB=kort -p 5433:5432 postgres:17-alpine
```

The server creates the tables from `apps/server/db/schema.sql` on first start.

### 2. Server

Install the two binaries it needs:

```bash
winget install yt-dlp.yt-dlp Gyan.FFmpeg   # Windows
brew install yt-dlp ffmpeg                  # macOS
sudo apt install yt-dlp ffmpeg              # Debian/Ubuntu
```

Then:

```bash
cd apps/server
cp .env.example .env       # Windows: copy .env.example .env
                           # set DATABASE_URL, ANTHROPIC_API_KEY, DEV_USER_EMAIL
npm run dev                # the server listens on the port in .env (default 8787)
```

Optional in `.env`:

- `OPENAI_API_KEY` enables speech transcription of the video (Whisper). Without it, imports use the caption and on-screen text only.
- `COOKIES_FILE` points to a Netscape `cookies.txt` exported from a logged-in browser. Instagram and Facebook block many anonymous fetches; cookies make imports far more reliable.
- `SCRAPECREATORS_API_KEY` for stable Facebook/Instagram imports, `UNSPLASH_ACCESS_KEY` for stock photos when a recipe has no image.

### 3. App

```bash
cd apps/mobile
cp .env.example .env       # Windows: copy .env.example .env
                           # set EXPO_PUBLIC_API_URL
npm run web                # opens the web app at the address the command prints
```

`EXPO_PUBLIC_API_URL` is the server's address. When testing on a phone it must be reachable from the phone (your computer's LAN address, or the deployed server).

The web build is how Kort is used day to day: `npm run build:web` exports it into the server's `public/` folder, so one container serves the web app, the PWA manifest and the API.

### 4. Native builds (optional)

The app uses native modules (share sheet, keep-awake, web view), so **Expo Go will not work**. If you want a native iOS/Android build, create a development client once with EAS:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
```

Install it on the phone, then run `npx expo start` from `apps/mobile` and open the project from the dev client. iOS builds run in Expo's cloud, so any desktop OS works. `eas build --profile preview` makes installable builds (Android APK; iOS via TestFlight or ad-hoc).

## Everyday commands

```bash
npm run server       # server with reload
npm run web          # Expo web (dev)
npm run mobile       # Expo dev server for a native dev client
npm run build:web    # export the web app into apps/server/public
npm run typecheck    # all packages
npm run lint -w apps/mobile
```

## Deploy

Push to `main`. The GitHub Action (`.github/workflows/deploy.yml`) joins the private network, syncs the repo to the server, rebuilds the Compose stack, installs the Caddy site and runs a smoke test. Details in [deploy/README.md](deploy/README.md).

## Sharing

Everyone the sign-in lets through lands in the same household and sees the same recipes and shopping lists. `KORT_ALLOWED_EMAILS` limits who may use the API.

## Shopping lists

One list per shopping trip. The oldest open list is the one being shopped; later open lists are
for next time; finished lists stay as history (named by date, e.g. 19.10.26, or a title you give).

- Typing "15 מלפפון", "מלפפון 15", "2 ק"ג עגבניות" or "פלפל צהוב x3" splits into name / quantity /
  unit. Only known units count as a unit, so "פלפל צהוב" stays one name. Parser and keyword
  tables: packages/shared/src/grocery.ts (check them with apps/server/scripts/grocery-check.ts).
- Aisle and emoji are decided on the server when an item is added: keywords first, and one small
  Claude call for names the keywords do not know (apps/server/src/grocery.ts).
- "לא היה בסופר" greys the item on this list and copies it to the next list.
- "סיום קנייה" closes the list: bought and missing items stay as history, everything else moves
  to the next list.
