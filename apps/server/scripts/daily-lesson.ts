// Picks today's lesson for every family member who switched on "שיעור יומי במייל"
// and prints the emails as JSON (one object per recipient) for the sender job in
// the gallab-hub repo (.github/workflows/daily-lesson.yml), which runs this inside
// the kort container every morning:
//   docker exec kort npx tsx scripts/daily-lesson.ts          # records what was sent
//   docker exec kort npx tsx scripts/daily-lesson.ts --dry    # just prints, records nothing
//
// Which lesson: the first one not completed in the app and not emailed yet; when
// every lesson has been emailed once, the ones still not completed go round again;
// when everything is completed, the course restarts from lesson 1.
import { LESSONS, lessonsForRecipe } from "@recipe/shared";
import { pool, q } from "../src/db.js";
import { renderLessonEmail } from "../src/lesson-email.js";

const dry = process.argv.includes("--dry");
const appUrl = process.env.APP_URL ?? "https://kort.gallab.top";

interface Subscriber {
  id: string;
  email: string;
  household_id: string | null;
}

const subscribers = await q<Subscriber>("select id, email, household_id from users where daily_lesson_email = true order by created_at");
const out: { to: string; subject: string; html: string; text: string; lesson: string }[] = [];

for (const user of subscribers) {
  const done = new Set((await q<{ lesson_id: string }>("select lesson_id from learning_progress where user_id = $1", [user.id])).map((r) => r.lesson_id));
  const sent = new Set((await q<{ lesson_id: string }>("select lesson_id from lesson_emails where user_id = $1", [user.id])).map((r) => r.lesson_id));

  let pick = LESSONS.find((l) => !done.has(l.id) && !sent.has(l.id));
  if (!pick) pick = LESSONS.find((l) => !done.has(l.id));
  if (!pick) {
    // Everything completed: start the cycle again.
    if (!dry) await q("delete from lesson_emails where user_id = $1", [user.id]);
    pick = LESSONS[0]!;
  } else if (!LESSONS.some((l) => !done.has(l.id) && !sent.has(l.id)) && !dry) {
    // Every unfinished lesson was emailed once already: forget the old sends so they can go round again.
    await q("delete from lesson_emails where user_id = $1", [user.id]);
  }

  const recipes = user.household_id
    ? await q<{ id: string; title: string; category: string; tags: string[]; ingredients: { name: string }[] }>(
        "select id, title, category, tags, ingredients from recipes where household_id = $1 order by created_at desc",
        [user.household_id],
      )
    : [];
  const related = recipes.filter((r) => lessonsForRecipe(r).some((l) => l.id === pick!.id)).slice(0, 4);

  const mail = renderLessonEmail({ lesson: pick, total: LESSONS.length, appUrl, recipes: related });
  out.push({ to: user.email, lesson: pick.id, ...mail });
  if (!dry) {
    await q("insert into lesson_emails (user_id, lesson_id) values ($1, $2) on conflict (user_id, lesson_id) do update set sent_at = now()", [user.id, pick.id]);
  }
}

process.stdout.write(JSON.stringify(out) + "\n");
await pool.end();
