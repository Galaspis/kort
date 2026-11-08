import { COURSE_ORDER, MEALS, courseOf, mealOf, type CourseId, type Lesson } from "@recipe/shared";

/**
 * The daily lesson as an email. Plain tables and inline styles so Gmail on the
 * phone renders it right-to-left with the Kort colours. Images come from the
 * public icon files on kort.gallab.top (served without the login).
 */
export interface LessonEmailInput {
  lesson: Lesson;
  total: number;
  appUrl: string;
  /** The family's recipes where this lesson shows up (already matched). */
  recipes: { id: string; title: string }[];
  /** What the planner has for today; the email opens with it when there is something. */
  today?: { meal: string; course: string; title: string; recipe_id: string | null }[];
}

const CREAM = "#F9F2E6";
const INK = "#2B2B2B";
const MUTED = "#6F6359";
const TERRACOTTA = "#C7522F";
const TERRACOTTA_SOFT = "#FBE6DF";
const OLIVE = "#6B7F3F";
const OLIVE_SOFT = "#E8ECDC";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLessonEmail({ lesson, total, appUrl, recipes, today = [] }: LessonEmailInput): { subject: string; html: string; text: string } {
  const todayMeals = MEALS.filter((m) => today.some((t) => t.meal === m.id)).map((m) => ({
    meal: m,
    lines: today
      .filter((t) => t.meal === m.id)
      .sort((a, b) => (COURSE_ORDER[a.course as CourseId] ?? 9) - (COURSE_ORDER[b.course as CourseId] ?? 9)),
  }));
  const todayBlock = todayMeals.length
    ? `
  <tr><td style="padding:12px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TERRACOTTA_SOFT};border-radius:16px;">
      <tr><td style="padding:14px 18px;">
        <div style="font-size:13px;color:${TERRACOTTA};font-weight:bold;">🍽️ היום בתפריט</div>
        ${todayMeals
          .map(
            ({ meal, lines }) =>
              `<div style="font-size:15px;line-height:24px;color:${INK};margin-top:4px;"><span style="font-weight:bold;">${meal.emoji} ${meal.label}:</span> ${lines
                .map((l) =>
                  l.recipe_id
                    ? `<a href="${appUrl}/recipe/${l.recipe_id}" style="color:${TERRACOTTA};text-decoration:none;">${esc(l.title)}</a>`
                    : esc(l.title),
                )
                .join(" · ")}</div>`,
          )
          .join("")}
        <div style="margin-top:8px;"><a href="${appUrl}/plan" style="color:${TERRACOTTA};font-size:13px;text-decoration:none;">לתכנון השבוע ←</a></div>
      </td></tr>
    </table>
  </td></tr>`
    : "";
  const lessonUrl = `${appUrl}/learn/${lesson.id}`;
  const subject = `${lesson.emoji} שיעור ${lesson.number}: ${lesson.title}`;

  const cards = lesson.cards
    .map(
      (c) => `
      <tr><td style="padding:0 0 18px 0;">
        <div style="font-size:17px;font-weight:bold;color:${INK};margin:0 0 4px 0;">${esc(c.title)}</div>
        <div style="font-size:16px;line-height:26px;color:${INK};">${esc(c.text)}</div>
      </td></tr>`,
    )
    .join("");

  const steps = lesson.experiment.steps
    .map((s, i) => `<tr><td style="font-size:15px;line-height:24px;color:${INK};padding:2px 0;">${i + 1}. ${esc(s)}</td></tr>`)
    .join("");

  const related = recipes.length
    ? `
      <tr><td style="padding:22px 0 0 0;">
        <div style="font-size:15px;font-weight:bold;color:${MUTED};margin:0 0 8px 0;">במתכונים שלכם זה קורה כאן</div>
        ${recipes
          .map(
            (r) =>
              `<div style="padding:6px 0;"><a href="${appUrl}/recipe/${r.id}" style="color:${TERRACOTTA};font-size:16px;text-decoration:none;">🍳 ${esc(r.title)}</a></div>`,
          )
          .join("")}
      </td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;font-family:Heebo,Arial,Helvetica,sans-serif;direction:rtl;text-align:right;">
  <tr><td align="center" style="padding:24px 24px 8px 24px;">
    <img src="${appUrl}/logo.png" width="160" alt="KORT" style="display:block;width:160px;height:auto;">
  </td></tr>${todayBlock}
  <tr><td align="center" style="padding:4px 24px 0 24px;">
    <div style="font-size:13px;color:${MUTED};">השיעור היומי · ${lesson.number} מתוך ${total}</div>
  </td></tr>
  <tr><td align="center" style="padding:14px 24px 0 24px;">
    <div style="font-size:56px;line-height:64px;">${lesson.emoji}</div>
    <div style="font-size:26px;font-weight:bold;color:${INK};margin-top:6px;">${esc(lesson.title)}</div>
    <div style="font-size:15px;color:${MUTED};margin-top:4px;">${esc(lesson.subtitle)} · ${lesson.minutes} דקות</div>
  </td></tr>
  <tr><td style="padding:24px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
  </td></tr>
  <tr><td style="padding:4px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OLIVE_SOFT};border-radius:16px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:13px;color:${OLIVE};font-weight:bold;">נסו הערב · 5 דקות במטבח</div>
        <div style="font-size:17px;font-weight:bold;color:${INK};margin:4px 0 8px 0;">${esc(lesson.experiment.title)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:24px 24px 0 24px;">
    <a href="${lessonUrl}" style="display:inline-block;background:${TERRACOTTA};color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:999px;">לשאלון ולשיעור בקורט ←</a>
    <div style="font-size:13px;color:${MUTED};margin-top:10px;">${lesson.quiz.length === 1 ? "שאלה אחת" : `${lesson.quiz.length} שאלות`} קצרות מסמנות את השיעור כהושלם</div>
  </td></tr>
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${related}</table>
  </td></tr>
  <tr><td align="center" style="padding:28px 24px 24px 24px;">
    <img src="${appUrl}/icon-192.png" width="40" height="40" alt="" style="display:block;border-radius:12px;">
    <div style="font-size:12px;color:${MUTED};margin-top:10px;line-height:18px;">
      קורט · קצת מזה. קצת מזה.<br>
      המייל הזה יוצא כל בוקר עם השיעור הבא. לעצור: בקורט, הגדרות ← שיעור יומי במייל.
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    ...(todayMeals.length
      ? ["היום בתפריט:", ...todayMeals.map(({ meal, lines }) => `${meal.label}: ${lines.map((l) => `${courseOf(l.course).label} - ${l.title}`).join(", ")}`), ""]
      : []),
    `${lesson.emoji} שיעור ${lesson.number} מתוך ${total}: ${lesson.title}`,
    lesson.subtitle,
    "",
    ...lesson.cards.flatMap((c) => [c.title, c.text, ""]),
    `נסו הערב: ${lesson.experiment.title}`,
    ...lesson.experiment.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `לשיעור בקורט: ${lessonUrl}`,
    ...(recipes.length ? ["", "במתכונים שלכם:", ...recipes.map((r) => `- ${r.title}: ${appUrl}/recipe/${r.id}`)] : []),
    "",
    "לעצור את המייל היומי: קורט ← הגדרות ← שיעור יומי במייל.",
  ].join("\n");

  return { subject, html, text };
}
