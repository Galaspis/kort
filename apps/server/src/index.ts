import { readFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import {
  classifyGrocery,
  extractFirstUrl,
  type ImportJobRow,
  type RecipeRow,
  type ShoppingItemRow,
  type ShoppingListRow,
  type ShoppingListSummary,
} from "@recipe/shared";
import { resolveCaller, type Caller } from "./auth.js";
import { migrate, one, q, setClause } from "./db.js";
import { env } from "./env.js";
import { backfillShoppingMeta, enrichShoppingItems } from "./grocery.js";
import { enrichManualRecipe, estimateNutrition } from "./import/extract.js";
import { findStockImage } from "./import/image.js";
import { runImport } from "./import/pipeline.js";
import { fetchAndStoreVideo } from "./import/video.js";
import { enrichSawLink } from "./saw.js";
import { mediaRoot, saveMedia } from "./storage.js";

type Variables = { caller: Caller };

const app = new Hono<{ Variables: Variables }>();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true, model: env.claudeModel }));

// Images and videos. Behind the same login as everything else (Caddy), served from disk.
app.use("/media/*", serveStatic({ root: path.relative(process.cwd(), mediaRoot) || ".", rewriteRequestPath: (p) => p.replace(/^\/media/, "") }));

// Everything under /api needs a family member (identity from the hub login).
app.use("/api/*", async (c, next) => {
  const caller = await resolveCaller(c.req.raw.headers);
  if (!caller) return c.json({ error: "unauthorized" }, 401);
  c.set("caller", caller);
  await next();
});

// ---------------------------------------------------------------------------
// Who am I / household
// ---------------------------------------------------------------------------
app.get("/api/me", async (c) => {
  const caller = c.get("caller");
  const members = await q<{ id: string; display_name: string | null }>(
    "select id, display_name from users where household_id = $1 order by created_at",
    [caller.householdId],
  );
  const household = await one<{ id: string; name: string }>("select id, name from households where id = $1", [caller.householdId]);
  return c.json({ id: caller.userId, email: caller.email, display_name: caller.displayName, household, members });
});

app.patch("/api/me", async (c) => {
  const caller = c.get("caller");
  const body = z.object({ display_name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "שם לא תקין" }, 400);
  await q("update users set display_name = $1 where id = $2", [body.data.display_name, caller.userId]);
  return c.json({ ok: true });
});

// Change counter: the app polls this instead of a realtime socket.
app.get("/api/version", async (c) => {
  const caller = c.get("caller");
  const row = await one<{ version: number }>("select version from household_versions where household_id = $1", [caller.householdId]);
  return c.json({ version: Number(row?.version ?? 0) });
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
const RECIPE_COLS = [
  "title","description","servings","prep_minutes","cook_minutes","category","cuisine","difficulty","tags","ingredients","steps",
  "original_language","confidence","warnings","source_url","source_platform","video_url","thumbnail_url","author","caption",
  "image_url","notes","rating","times_cooked","is_favorite","nutrition","kids_approved",
] as const;
const RECIPE_JSON = ["ingredients", "steps", "nutrition"] as const;

app.get("/api/recipes", async (c) => {
  const caller = c.get("caller");
  const rows = await q<RecipeRow>("select * from recipes where household_id = $1 order by created_at desc", [caller.householdId]);
  return c.json(rows);
});

app.get("/api/recipes/:id", async (c) => {
  const caller = c.get("caller");
  const row = await one<RecipeRow>("select * from recipes where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

app.post("/api/recipes", async (c) => {
  const caller = c.get("caller");
  const input = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input || typeof input.title !== "string" || !input.title.trim()) return c.json({ error: "חסרה כותרת" }, 400);
  const cols = RECIPE_COLS.filter((k) => k in input);
  const vals = cols.map((k) => (RECIPE_JSON.includes(k as never) ? JSON.stringify(input[k]) : input[k]));
  const row = await one<RecipeRow>(
    `insert into recipes (household_id, created_by, source_platform${cols.length ? ", " + cols.join(", ") : ""})
     values ($1, $2, 'manual'${cols.map((_, i) => `, $${i + 3}`).join("")})
     ${cols.includes("source_platform") ? "" : ""} returning *`,
    [caller.householdId, caller.userId, ...vals],
  );
  return c.json(row, 201);
});

app.patch("/api/recipes/:id", async (c) => {
  const caller = c.get("caller");
  const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch) return c.json({ error: "bad request" }, 400);
  const set = setClause(patch, RECIPE_COLS, RECIPE_JSON);
  if (!set) return c.json({ error: "nothing to update" }, 400);
  const row = await one<RecipeRow>(
    `update recipes set ${set.sql} where id = $${set.next} and household_id = $${set.next + 1} returning *`,
    [...set.values, c.req.param("id"), caller.householdId],
  );
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

app.delete("/api/recipes/:id", async (c) => {
  const caller = c.get("caller");
  await q("delete from recipes where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Shopping lists: one per trip. The oldest open list is the one being shopped
// ("current"); later open lists are for next time; finished lists are history.
// ---------------------------------------------------------------------------
async function openLists(householdId: string) {
  return q<ShoppingListRow>(
    "select * from shopping_lists where household_id = $1 and status = 'open' order by created_at, id",
    [householdId],
  );
}

/** The list being shopped now (created when the household has none). */
async function currentList(householdId: string): Promise<ShoppingListRow> {
  const lists = await openLists(householdId);
  if (lists[0]) return lists[0];
  return (await one<ShoppingListRow>("insert into shopping_lists (household_id) values ($1) returning *", [householdId]))!;
}

/** The open list after `after` (created when there is none yet). */
async function listAfter(householdId: string, after: ShoppingListRow): Promise<ShoppingListRow> {
  const lists = await openLists(householdId);
  const later = lists.find((l) => l.id !== after.id && l.created_at >= after.created_at);
  if (later) return later;
  return (await one<ShoppingListRow>("insert into shopping_lists (household_id) values ($1) returning *", [householdId]))!;
}

async function ownedList(householdId: string, id: string): Promise<ShoppingListRow | null> {
  return one<ShoppingListRow>("select * from shopping_lists where id = $1 and household_id = $2", [id, householdId]);
}

app.get("/api/shopping/lists", async (c) => {
  const caller = c.get("caller");
  await currentList(caller.householdId);
  const rows = await q<ShoppingListSummary>(
    `select l.*,
            (count(i.id))::int as total,
            (count(i.id) filter (where i.checked))::int as checked,
            (count(i.id) filter (where i.unavailable))::int as unavailable
     from shopping_lists l left join shopping_items i on i.list_id = l.id
     where l.household_id = $1
     group by l.id order by l.created_at, l.id`,
    [caller.householdId],
  );
  return c.json(rows);
});

app.post("/api/shopping/lists", async (c) => {
  const caller = c.get("caller");
  const body = z.object({ title: z.string().trim().max(80).nullable().optional() }).safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!body.success) return c.json({ error: "bad request" }, 400);
  const row = await one<ShoppingListRow>("insert into shopping_lists (household_id, title) values ($1, $2) returning *", [
    caller.householdId,
    body.data.title || null,
  ]);
  return c.json(row);
});

app.patch("/api/shopping/lists/:id", async (c) => {
  const caller = c.get("caller");
  const body = z.object({ title: z.string().trim().max(80).nullable() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "bad request" }, 400);
  const row = await one<ShoppingListRow>(
    "update shopping_lists set title = $1 where id = $2 and household_id = $3 returning *",
    [body.data.title || null, c.req.param("id"), caller.householdId],
  );
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

app.delete("/api/shopping/lists/:id", async (c) => {
  const caller = c.get("caller");
  await q("delete from shopping_lists where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  return c.json({ ok: true });
});

/**
 * "סיום קנייה": the list becomes history (with what was bought and what was
 * missing), and everything still unchecked moves to the next list.
 */
app.post("/api/shopping/lists/:id/finish", async (c) => {
  const caller = c.get("caller");
  const list = await ownedList(caller.householdId, c.req.param("id"));
  if (!list) return c.json({ error: "not found" }, 404);
  if (list.status !== "open") return c.json({ error: "הרשימה כבר הסתיימה" }, 400);
  const next = await listAfter(caller.householdId, list);
  await q("update shopping_lists set status = 'done', done_at = now() where id = $1", [list.id]);
  await q("update shopping_items set list_id = $1 where list_id = $2 and checked = false and unavailable = false", [next.id, list.id]);
  // Nothing bought and nothing missing: there is no history worth keeping.
  const left = await one<{ n: number }>("select count(*)::int as n from shopping_items where list_id = $1", [list.id]);
  if (!left || left.n === 0) await q("delete from shopping_lists where id = $1", [list.id]);
  return c.json({ next });
});

// ---------------------------------------------------------------------------
// Shopping items
// ---------------------------------------------------------------------------
app.get("/api/shopping", async (c) => {
  const caller = c.get("caller");
  const wanted = c.req.query("list");
  const list = wanted ? await ownedList(caller.householdId, wanted) : await currentList(caller.householdId);
  if (!list) return c.json({ error: "not found" }, 404);
  const rows = await q<ShoppingItemRow>(
    "select * from shopping_items where list_id = $1 order by checked, unavailable, created_at desc",
    [list.id],
  );
  return c.json(rows);
});

const newItem = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  aisle: z.string().nullable().default(null),
  recipe_id: z.string().uuid().nullable().optional(),
  recipe_title: z.string().nullable().optional(),
  list_id: z.string().uuid().nullable().optional(),
});

/**
 * Adds items to a list (the current one unless list_id says otherwise), merging
 * into an existing open item with the same name and unit. Aisle and emoji come
 * from keywords right away; unknown names are classified by the model afterwards.
 */
app.post("/api/shopping", async (c) => {
  const caller = c.get("caller");
  const body = z.array(newItem).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "bad request" }, 400);
  const wanted = body.data.find((i) => i.list_id)?.list_id;
  const list = (wanted && (await ownedList(caller.householdId, wanted))) || (await currentList(caller.householdId));
  const existing = await q<ShoppingItemRow>(
    "select * from shopping_items where list_id = $1 and checked = false and unavailable = false",
    [list.id],
  );
  const added: string[] = [];
  for (const item of body.data) {
    const name = item.name.trim();
    const match = existing.find((e) => e.name.trim() === name && (e.unit ?? null) === (item.unit ?? null));
    if (match) {
      if (item.quantity !== null && match.quantity !== null) {
        await q("update shopping_items set quantity = $1 where id = $2", [match.quantity + item.quantity, match.id]);
        match.quantity += item.quantity;
      }
      continue;
    }
    const guess = classifyGrocery(name);
    const aisle = item.aisle && item.aisle !== "אחר" ? item.aisle : guess.confident ? guess.aisle : (item.aisle ?? "אחר");
    const emoji = guess.confident ? guess.emoji : null;
    const row = await one<ShoppingItemRow>(
      `insert into shopping_items (household_id, list_id, name, quantity, unit, aisle, emoji, recipe_id, recipe_title)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [caller.householdId, list.id, name, item.quantity, item.unit, aisle, emoji, item.recipe_id ?? null, item.recipe_title ?? null],
    );
    if (row) {
      existing.push(row);
      if (!emoji || aisle === "אחר") added.push(row.id);
    }
  }
  if (added.length) void enrichShoppingItems(added).catch((err) => console.warn("[grocery] enrich failed:", (err as Error).message));
  return c.json({ ok: true, list_id: list.id });
});

app.patch("/api/shopping/:id", async (c) => {
  const caller = c.get("caller");
  const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (patch && typeof patch.list_id === "string" && !(await ownedList(caller.householdId, patch.list_id))) {
    return c.json({ error: "not found" }, 404);
  }
  const set = patch && setClause(patch, ["name", "quantity", "unit", "aisle", "checked", "unavailable", "list_id", "emoji"]);
  if (!set) return c.json({ error: "bad request" }, 400);
  const row = await one<ShoppingItemRow>(
    `update shopping_items set ${set.sql} where id = $${set.next} and household_id = $${set.next + 1} returning *`,
    [...set.values, c.req.param("id"), caller.householdId],
  );
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

/**
 * "לא היה בסופר": the item stays on this list, greyed out, and a copy goes to
 * the next list so it is not forgotten. Turning it off removes that copy.
 */
app.post("/api/shopping/:id/unavailable", async (c) => {
  const caller = c.get("caller");
  const body = z.object({ value: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "bad request" }, 400);
  const item = await one<ShoppingItemRow>("select * from shopping_items where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  if (!item || !item.list_id) return c.json({ error: "not found" }, 404);
  const list = await ownedList(caller.householdId, item.list_id);
  if (!list) return c.json({ error: "not found" }, 404);
  const next = await listAfter(caller.householdId, list);
  if (body.data.value) {
    await q("update shopping_items set unavailable = true, checked = false where id = $1", [item.id]);
    const dup = await one(
      "select id from shopping_items where list_id = $1 and checked = false and name = $2 and unit is not distinct from $3",
      [next.id, item.name, item.unit],
    );
    if (!dup) {
      await q(
        `insert into shopping_items (household_id, list_id, name, quantity, unit, aisle, emoji, recipe_id, recipe_title)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [caller.householdId, next.id, item.name, item.quantity, item.unit, item.aisle, item.emoji, item.recipe_id, item.recipe_title],
      );
    }
  } else {
    await q("update shopping_items set unavailable = false where id = $1", [item.id]);
    await q(
      `delete from shopping_items where id = (
         select id from shopping_items where list_id = $1 and checked = false and name = $2 and unit is not distinct from $3
         order by created_at desc limit 1)`,
      [next.id, item.name, item.unit],
    );
  }
  const row = await one<ShoppingItemRow>("select * from shopping_items where id = $1", [item.id]);
  return c.json(row);
});

app.post("/api/shopping/delete", async (c) => {
  const caller = c.get("caller");
  const body = z.object({ ids: z.array(z.string().uuid()).min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "bad request" }, 400);
  await q("delete from shopping_items where household_id = $1 and id = any($2::uuid[])", [caller.householdId, body.data.ids]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Uploads (a photo chosen in the recipe form)
// ---------------------------------------------------------------------------
app.post("/api/upload", async (c) => {
  const type = c.req.header("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) return c.json({ error: "empty" }, 400);
  if (bytes.length > 15 * 1024 * 1024) return c.json({ error: "התמונה גדולה מדי" }, 413);
  const url = await saveMedia("recipe-images", `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, bytes);
  return c.json({ url });
});

// ---------------------------------------------------------------------------
// Imports (share a link → recipe)
// ---------------------------------------------------------------------------
const MAX_CONCURRENT = 2;
let running = 0;
const queue: ImportJobRow[] = [];
function enqueue(job: ImportJobRow) { queue.push(job); pump(); }
function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    running += 1;
    runImport(job).finally(() => { running -= 1; pump(); });
  }
}

const importBody = z.object({ url: z.string().max(4000).optional(), text: z.string().max(20_000).optional() });

app.post("/api/import", async (c) => {
  const parsed = importBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "צריך קישור או טקסט" }, 400);
  const { url, text } = parsed.data;
  const sourceUrl = extractFirstUrl(url) ?? extractFirstUrl(text);
  if (!sourceUrl && !text?.trim()) return c.json({ error: "צריך קישור או טקסט" }, 400);
  const caller = c.get("caller");
  const job = await one<ImportJobRow>(
    `insert into import_jobs (household_id, user_id, source_url, source_text, status, progress)
     values ($1,$2,$3,$4,'queued','ממתין בתור...') returning *`,
    [caller.householdId, caller.userId, sourceUrl, text ?? null],
  );
  if (!job) return c.json({ error: "failed" }, 500);
  enqueue(job);
  return c.json(job, 202);
});

app.get("/api/import/:id", async (c) => {
  const caller = c.get("caller");
  const job = await one<ImportJobRow>("select * from import_jobs where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  return job ? c.json(job) : c.json({ error: "not found" }, 404);
});

const enrichBody = z.object({
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  servings: z.number().nullable().default(null),
  ingredientsText: z.string().min(1),
  stepsText: z.string().min(1),
});
app.post("/api/enrich", async (c) => {
  const parsed = enrichBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "חסרים פרטים במתכון" }, 400);
  try { return c.json(await enrichManualRecipe(parsed.data)); }
  catch (err) { return c.json({ error: (err as Error).message }, 500); }
});

// ---------------------------------------------------------------------------
// Saw: woodworking link-saver at woody.gallab.top/saw. Woody's Caddy proxies /api/saw/*
// here, so the caller is the same family login. Links only: caption + thumbnail copy +
// Hebrew summary go back to the page; nothing is written to Kort's database.
// ---------------------------------------------------------------------------
const sawBody = z.object({ url: z.string().max(4000), text: z.string().max(20_000).optional() });
app.post("/api/saw/enrich", async (c) => {
  const parsed = sawBody.safeParse(await c.req.json().catch(() => ({})));
  const url = parsed.success ? extractFirstUrl(parsed.data.url) : null;
  if (!url) return c.json({ error: "צריך קישור" }, 400);
  try {
    const result = await enrichSawLink(url, parsed.success ? parsed.data.text?.trim() || null : null);
    if (result.thumbnail_url?.startsWith("/")) result.thumbnail_url = env.publicUrl + result.thumbnail_url;
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.post("/api/recipes/:id/nutrition", async (c) => {
  const caller = c.get("caller");
  const recipe = await one<{ id: string; title: string; servings: number | null; ingredients: unknown }>(
    "select id, title, servings, ingredients from recipes where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  if (!recipe) return c.json({ error: "not found" }, 404);
  try {
    const nutrition = await estimateNutrition(recipe as Parameters<typeof estimateNutrition>[0]);
    await q("update recipes set nutrition = $1 where id = $2", [JSON.stringify(nutrition), recipe.id]);
    return c.json(nutrition);
  } catch (err) { return c.json({ error: (err as Error).message }, 500); }
});

app.post("/api/recipes/:id/video", async (c) => {
  const caller = c.get("caller");
  const recipe = await one<{ id: string; source_url: string | null }>(
    "select id, source_url from recipes where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  if (!recipe) return c.json({ error: "not found" }, 404);
  try { return c.json({ video_url: await fetchAndStoreVideo(recipe) }); }
  catch (err) { return c.json({ error: (err as Error).message }, 500); }
});

app.post("/api/recipes/:id/image", async (c) => {
  const caller = c.get("caller");
  const recipe = await one<{ id: string; title: string; description: string | null; category: string; cuisine: string | null; image_url: string | null }>(
    "select id, title, description, category, cuisine, image_url from recipes where id = $1 and household_id = $2", [c.req.param("id"), caller.householdId]);
  if (!recipe) return c.json({ error: "not found" }, 404);
  if (recipe.image_url) return c.json({ image_url: recipe.image_url });
  try {
    const found = await findStockImage(recipe);
    if (found) await q("update recipes set image_url = $1 where id = $2", [found.url, recipe.id]);
    return c.json({ image_url: found?.url ?? null });
  } catch (err) { return c.json({ error: (err as Error).message }, 500); }
});

// ---------------------------------------------------------------------------
// The web app. `npm run build:web` exports it into ./public (index.html is
// renamed app.html so we can inject the public config before serving it).
// ---------------------------------------------------------------------------
const webDir = path.resolve(process.env.WEB_DIR ?? "public");
const publicConfig = JSON.stringify({ EXPO_PUBLIC_API_URL: "" });
app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDir) || ".", index: "app.none" }));
const PWA_HEAD = [
  `<script>window.__ENV__=${publicConfig}</script>`,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
  '<link rel="manifest" href="/manifest.json" />',
  '<meta name="theme-color" content="#C7522F" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="קורט" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />',
  '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />',
].join("");

app.get("*", async (c) => {
  const html = await readFile(path.join(webDir, "app.html"), "utf8").catch(() => null);
  if (!html) return c.text("Web build not found. Run: npm run build:web", 404);
  const page = html
    .replace(/<html[^>]*>/, '<html lang="he" dir="rtl">')
    .replace(/<meta name="viewport"[^>]*>/, "")
    .replace("<head>", `<head>${PWA_HEAD}`);
  return c.html(page);
});

// A deploy restarts the container mid-import; those jobs would otherwise spin forever.
async function failAbandonedJobs() {
  const rows = await q<{ id: string }>(
    `update import_jobs set status = 'failed', progress = null, error = 'השרת הופעל מחדש באמצע הייבוא. שתפו את הקישור שוב.'
     where status in ('queued','fetching','analyzing') returning id`,
  );
  if (rows.length) console.log(`[jobs] marked ${rows.length} abandoned import(s) as failed`);
}

await migrate();
await failAbandonedJobs().catch((err) => console.warn("[jobs] cleanup failed:", (err as Error).message));
void backfillShoppingMeta().catch((err) => console.warn("[grocery] backfill failed:", (err as Error).message));

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`recipe server listening on http://localhost:${info.port} (model: ${env.claudeModel}, hub auth: ${env.hubAuth})`);
});
