/**
 * "Deep" lessons: the master-course format on top of a regular lesson.
 * A lesson that has an entry here gets, after its idea cards:
 *   see   → an interactive picture and short clips of what it should look like
 *   cook  → a real dish, step by step, with "what do you see?" checkpoints
 *   fix   → the common failures, what caused them and what to do
 *   quiz  → the regular questions plus harder ones
 * Lessons without an entry keep the short format (cards, experiment, quiz).
 */
import type { QuizQuestion } from "./course";

/** A short clip of what something should look like. `video` stays null until the clip is made. */
export interface LessonClip {
  id: string;
  title: string;
  /** What to look (and listen) for. Shown under the clip, and instead of it while there is no video. */
  look: string;
  /** Served from /media/course/<lesson>/<id>.mp4 once it exists. */
  video: string | null;
  /** English prompt for the video model that makes the clip. Not shown in the app. */
  prompt: string;
}

/** A stop in the guided cook where the cook compares the pan with what it should be. */
export interface Checkpoint {
  ask: string;
  good: { label: string; reply: string };
  bad: { label: string; reply: string };
}

export interface GuidedStep {
  text: string;
  /** Waiting time, when the step has one. */
  seconds?: number;
  checkpoint?: Checkpoint;
}

/** A complete small dish that practises the lesson. Not tied to the family's recipes. */
export interface GuidedDish {
  id: string;
  emoji: string;
  title: string;
  /** Why this dish is the practice for this lesson. */
  why: string;
  minutes: number;
  servings: number;
  ingredients: string[];
  steps: GuidedStep[];
}

/** How a failed result looks; the app draws each one. */
export type FailureLook = "grey" | "burnt" | "flooded" | "stuck" | "bitter";

export interface LessonFailure {
  id: string;
  look: FailureLook;
  symptom: string;
  cause: string;
  fix: string;
}

export interface DeepLesson {
  /** Which interactive picture the app shows. One per lesson, drawn in the app. */
  visual: "browning";
  visualIntro: string;
  clips: LessonClip[];
  dishes: GuidedDish[];
  failures: LessonFailure[];
  /** Harder questions, asked after the lesson's regular quiz. */
  mastery: QuizQuestion[];
}

export const DEEP_LESSONS: Record<string, DeepLesson> = {
  browning: {
    visual: "browning",
    visualIntro:
      "הזיזו את טמפרטורת המחבת וראו מה קורה לסטייק. אחר כך נסו את אותו הדבר עם בשר רטוב.",
    clips: [
      {
        id: "oil-ready",
        title: "שמן שמוכן לצריבה",
        look: "השמן מנצנץ ונע במחבת בקלות כמו מים, עם אדוות דקות על פניו. חוט עשן ראשון אומר: עכשיו.",
        video: null,
        prompt:
          "Close-up, 45-degree angle, of a stainless steel skillet on a gas flame. A thin layer of neutral oil heats until it shimmers and ripples and flows as fluidly as water when the pan is tilted slightly; one faint wisp of smoke rises at the end. No food, no hands, no text. Natural kitchen light, shallow depth of field, realistic.",
      },
      {
        id: "wet-vs-dry",
        title: "רטוב מול יבש",
        look: "אותה מחבת, אותו חום. הנתח היבש רוחש ומקבל קרום חום. הנתח הרטוב מעלה אדים, שלולית נוזלים סביבו, והוא נשאר אפור.",
        video: null,
        prompt:
          "Overhead shot of one hot cast-iron skillet with two raw beef steaks placed side by side. The left steak is patted dry and sears: steady sizzling, a deep brown crust forming at its edges. The right steak is visibly wet: steam billows, grey liquid pools around it and it turns pale grey with no crust. No hands, no text. Realistic, natural light.",
      },
      {
        id: "releases",
        title: "הקרום משתחרר לבד",
        look: "אחרי שתי דקות בלי לגעת, הנתח מתרומם מהמחבת בלי התנגדות ומתחתיו קרום חום אחיד. אם הוא דבוק, הוא עוד לא מוכן להיפוך.",
        video: null,
        prompt:
          "Close-up side view of a steak searing in a stainless steel skillet. Metal tongs lift one edge of the steak: it releases cleanly from the pan with no sticking, revealing an even deep-brown crust underneath, then it is turned over. Only the tongs are visible, no hands, no text. Realistic, natural light.",
      },
      {
        id: "fond",
        title: "פונד ודגלייז",
        look: "בתחתית המחבת נשארים כתמים חומים (לא שחורים). שופכים נוזל, מגרדים בכף עץ, והנוזל הופך תוך שניות לרוטב חום.",
        video: null,
        prompt:
          "Close-up of an empty stainless steel skillet just after searing meat, with brown (not black) caramelized bits stuck to the bottom. Red wine is poured in and bubbles vigorously; a wooden spoon scrapes the bottom and the liquid turns into a glossy brown sauce as the pan bottom becomes clean. Only the spoon is visible, no hands, no text. Realistic, natural light.",
      },
    ],
    dishes: [
      {
        id: "pan-steak",
        emoji: "🥩",
        title: "סטייק במחבת עם רוטב מהפונד",
        why: "כל השיעור בצלחת אחת: משטח יבש, מחבת לוהטת, לא לגעת, מנוחה, והפונד שהופך לרוטב.",
        minutes: 25,
        servings: 2,
        ingredients: [
          "2 סטייקים (אנטריקוט או סינטה) בעובי 2.5 ס\"מ בערך",
          "מלח גס ופלפל שחור",
          "2 כפות שמן קנולה או חמניות",
          "שן שום כתושה",
          "חצי כוס יין אדום או ציר",
          "כפית חרדל",
        ],
        steps: [
          {
            text: "הוציאו את הסטייקים מהמקרר 20 עד 30 דקות לפני. נגבו אותם היטב במגבת נייר משני הצדדים והמליחו בנדיבות.",
          },
          {
            text: "חממו מחבת כבדה (ברזל או נירוסטה, לא טפלון) על אש גבוהה 2 עד 3 דקות. הוסיפו את השמן.",
            checkpoint: {
              ask: "מה השמן עושה?",
              good: {
                label: "מנצנץ ונע כמו מים",
                reply: "מוכן. המחבת בערך ב-200 עד 220 מעלות, בדיוק אזור הצריבה.",
              },
              bad: {
                label: "שוכב סמיך ושקט",
                reply: "עוד לא. חכו עוד דקה. מחבת פושרת נותנת סטייק אפור.",
              },
            },
          },
          {
            text: "הניחו את הסטייקים במחבת, בתנועה הרחק מכם, עם רווח ביניהם.",
            checkpoint: {
              ask: "מה שומעים?",
              good: {
                label: "רחש חזק ויציב",
                reply: "זה הקול של מים שמתאדים מיד. המשטח נשאר יבש וההשחמה התחילה.",
              },
              bad: {
                label: "רחש חלש או בעבוע",
                reply: "המחבת התקררה או שהבשר רטוב. הוציאו סטייק אחד, תנו למחבת דקה להתחמם, והמשיכו בנגלות.",
              },
            },
          },
          {
            text: "לא לגעת, לא להזיז, לא ללחוץ. שתיים וחצי דקות.",
            seconds: 150,
            checkpoint: {
              ask: "נסו להרים פינה במלקחיים. מה קורה?",
              good: {
                label: "משתחרר לבד, קרום חום",
                reply: "זה הסימן להפוך. קרום שנוצר נפרד מהמחבת בעצמו.",
              },
              bad: {
                label: "דבוק למחבת",
                reply: "הקרום עוד לא נוצר. אל תמשכו בכוח. חכו חצי דקה ונסו שוב.",
              },
            },
          },
          {
            text: "הפכו. עוד שתיים וחצי דקות לצד השני (מדיום-רייר; במדחום 54 עד 57 מעלות במרכז).",
            seconds: 150,
          },
          {
            text: "העבירו לצלחת ותנו לנוח 5 דקות. בינתיים מכינים את הרוטב.",
            seconds: 300,
          },
          {
            text: "הנמיכו לאש בינונית. שום למחבת ל-20 שניות, ואז היין או הציר. גרדו את התחתית בכף עץ.",
            checkpoint: {
              ask: "מה צבע הנוזל?",
              good: {
                label: "חום, והתחתית מתנקה",
                reply: "זה הפונד שנמס לתוך הנוזל. כל הטעם שנוצר בצריבה נמצא עכשיו ברוטב.",
              },
              bad: {
                label: "שחור עם פירורים",
                reply: "הפונד נשרף והרוטב יהיה מר. ותרו עליו הפעם. בפעם הבאה הנמיכו מעט את האש אחרי ההיפוך.",
              },
            },
          },
          {
            text: "צמצמו לחצי (2 עד 3 דקות). ערבבו פנימה את החרדל ואת המיץ שנקווה בצלחת של הסטייק. טעמו, תקנו מלח, ומזגו על הבשר.",
          },
        ],
      },
      {
        id: "seared-mushrooms",
        emoji: "🍄",
        title: "פטריות צרובות עם שום ופטרוזיליה",
        why: "פטריות הן 90% מים, אז הן המבחן הכי טוב לכלל \"מים הם האויב\". עשר דקות, בלי בשר, ורואים הכול.",
        minutes: 12,
        servings: 3,
        ingredients: [
          "400 גרם פטריות שמפיניון או פורטובלו",
          "2 כפות שמן זית",
          "2 שיני שום פרוסות",
          "חופן פטרוזיליה קצוצה",
          "מלח, פלפל שחור",
          "סחיטה של לימון",
        ],
        steps: [
          {
            text: "נגבו את הפטריות במגבת נייר לחה (לא לשטוף במים) וחתכו לרבעים.",
          },
          {
            text: "חממו מחבת רחבה על אש גבוהה 2 דקות והוסיפו את השמן.",
          },
          {
            text: "הכניסו את הפטריות בשכבה אחת. אם לא נכנסות כולן, צרבו בשתי נגלות.",
            checkpoint: {
              ask: "יש רווח בין הפטריות?",
              good: {
                label: "כן, רואים את המחבת ביניהן",
                reply: "מצוין. האדים בורחים והמשטח נשאר יבש.",
              },
              bad: {
                label: "לא, הן צפופות",
                reply: "בצפיפות האדים נלכדים והפטריות מתבשלות במקום להישחם. הוציאו חצי וצרבו בנגלות.",
              },
            },
          },
          {
            text: "לא לערבב. שתיים וחצי דקות.",
            seconds: 150,
            checkpoint: {
              ask: "מה יש בתחתית המחבת?",
              good: {
                label: "יבש, רחש, שוליים זהובים",
                reply: "זו השחמה. הפכו והמשיכו.",
              },
              bad: {
                label: "שלולית של נוזלים",
                reply: "הפטריות שחררו מים. לא נורא: השאירו אש גבוהה, חכו שהנוזל יתאדה, ואז הן יתחילו להשחים.",
              },
            },
          },
          {
            text: "ערבבו והמשיכו עוד 2 עד 3 דקות, עד שהפטריות חומות-זהובות מכל הצדדים.",
            seconds: 150,
          },
          {
            text: "רק עכשיו: מלח, פלפל והשום. חצי דקה, עד שהשום מריח ולא משחים.",
            seconds: 30,
          },
          {
            text: "מורידים מהאש. פטרוזיליה וסחיטה של לימון. טעמו ותקנו.",
          },
        ],
      },
    ],
    failures: [
      {
        id: "grey",
        look: "grey",
        symptom: "אפור וחיוור, בלי קרום",
        cause: "המחבת לא הייתה חמה מספיק, או שהמשטח היה רטוב. כל עוד יש מים, המשטח תקוע ב-100 מעלות.",
        fix: "לנגב היטב, לחמם עד שהשמן מנצנץ, ולהניח רק כשיש רחש חזק.",
      },
      {
        id: "flooded",
        look: "flooded",
        symptom: "המחבת התמלאה נוזלים",
        cause: "יותר מדי בבת אחת. המחבת התקררה, האדים נלכדו, והכול התחיל להתבשל במיץ של עצמו.",
        fix: "לצרוב בנגלות, בשכבה אחת עם רווחים. אם זה כבר קרה: להוציא חצי ולהגביר אש.",
      },
      {
        id: "burnt",
        look: "burnt",
        symptom: "שחור בחוץ, נא בפנים",
        cause: "חום גבוה מדי לנתח עבה. החוץ נשרף לפני שהחום הספיק להגיע למרכז.",
        fix: "לצרוב שתי דקות מכל צד ולסיים בתנור ב-180 מעלות או על אש נמוכה. ולהוציא את הבשר מהמקרר מראש.",
      },
      {
        id: "stuck",
        look: "stuck",
        symptom: "נדבק ונקרע בהיפוך",
        cause: "הפכתם מוקדם מדי, או שהמחבת הייתה קרה כשהבשר נכנס.",
        fix: "לחכות. קרום שנוצר משתחרר מהמחבת לבד. אם צריך למשוך בכוח, עוד לא הזמן.",
      },
      {
        id: "bitter",
        look: "bitter",
        symptom: "הרוטב מר, פירורים שחורים",
        cause: "הפונד נשרף. חום ממושך מעל אזור ההשחמה הופך טעם עמוק לטעם מר.",
        fix: "להנמיך מעט את האש אחרי ההיפוך. פונד שחור מנגבים ולא עושים ממנו רוטב.",
      },
    ],
    mastery: [
      {
        q: "צרבתם שני סטייקים והכול היה מצוין. הוספתם עוד שניים והמחבת התחילה להעלות נוזלים. מה קרה?",
        options: ["הבשר לא היה טרי", "המחבת התקררה כי נכנס יותר מדי בשר בבת אחת", "היה חסר שמן"],
        answer: 1,
        why: "כל נתח קר מוריד את חום המחבת. מתחת לאזור הצריבה המים לא מתאדים מיד, נקווים, והבשר מתבשל. צורבים בנגלות.",
      },
      {
        q: "למה ממליחים פטריות רק בסוף הצריבה?",
        options: ["מלח מוציא מהן מים, ומים עוצרים את ההשחמה", "מלח שורף את הפטריות", "אין סיבה, זה רק הרגל"],
        answer: 0,
        why: "מלח מושך נוזלים החוצה. בפטריות, שהן רובן מים, זה מציף את המחבת. ממליחים אחרי שכבר השחימו.",
      },
      {
        q: "נתח בעובי 4 ס\"מ נשרף בחוץ ונשאר נא בפנים. מה התיקון?",
        options: ["להגביר עוד את האש", "לכסות את המחבת מההתחלה", "לצרוב קצר ואז לסיים בחום נמוך או בתנור"],
        answer: 2,
        why: "צריבה היא למשטח, לא למרכז. בנתח עבה מפרידים: חום גבוה לקרום, חום עדין כדי שהמרכז יתחמם בלי שהחוץ יישרף.",
      },
      {
        q: "באיזה שומן צורבים על אש גבוהה?",
        options: ["שמן זית כתית מעולה", "שמן מזוקק כמו קנולה או חמניות", "כל שמן, אין הבדל"],
        answer: 1,
        why: "שמן זית כתית מתחיל לעשן כבר סביב 190 עד 200 מעלות ונותן טעם מר. שמן מזוקק מחזיק עד בערך 230.",
      },
    ],
  },
};

export function deepLesson(id: string): DeepLesson | undefined {
  return DEEP_LESSONS[id];
}
