import { useRef, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";

import { AppText, Card, Chip, Row } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import { SteakArt, type SteakLook } from "./steak-art";

/**
 * The browning lesson's picture: drag the pan temperature and see what the
 * steak does (crust colour, the grey band, steam, smoke, how long a crust
 * takes, what it sounds like). A wet surface is modelled the way it behaves:
 * it is held near 100°C until the water is gone, so the same pan gives the
 * result of a much cooler one.
 */
const MIN = 80;
const MAX = 280;

type Stop<T> = [number, T];

function lerpNumber(stops: Stop<number>[], x: number): number {
  if (x <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i]!;
    const [x0, y0] = stops[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1]![1];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(stops: Stop<string>[], x: number): string {
  const channel = (i: 0 | 1 | 2) => Math.round(lerpNumber(stops.map(([at, c]) => [at, hexToRgb(c)[i]]), x));
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

const CRUST: Stop<string>[] = [
  [80, "#A39A92"],
  [120, "#A8998A"],
  [150, "#B08A5E"],
  [180, "#8A5A2B"],
  [220, "#5E3414"],
  [250, "#3F220E"],
  [270, "#17110E"],
];
const CENTER: Stop<string>[] = [
  [80, "#B39A93"],
  [140, "#C98880"],
  [190, "#D9727A"],
  [230, "#D9606C"],
  [280, "#B8404E"],
];

interface Zone {
  upTo: number;
  title: string;
  text: string;
  time: string;
  tone: "bad" | "ok" | "good";
}
const ZONES: Zone[] = [
  {
    upTo: 120,
    title: "מתבשל, לא משחים",
    text: "המים לא מתאדים מספיק מהר. המשטח נשאר רטוב, והבשר מאפיר ומתבשל במיץ של עצמו.",
    time: "לא ייווצר קרום",
    tone: "bad",
  },
  {
    upTo: 160,
    title: "השחמה איטית מדי",
    text: "ההשחמה מתחילה, אבל לאט. עד שייווצר קרום, הפנים כבר מבושל לגמרי: שכבה אפורה עבה מתחת לקרום.",
    time: "8 עד 12 דקות",
    tone: "bad",
  },
  {
    upTo: 200,
    title: "משחים",
    text: "קרום חום נוצר בקצב סביר. מתאים לנתחים דקים, לעוף ולירקות.",
    time: "4 עד 5 דקות",
    tone: "ok",
  },
  {
    upTo: 240,
    title: "אזור הצריבה",
    text: "קרום חום עמוק תוך דקות, והפנים נשאר ורוד. כאן צורבים סטייק.",
    time: "2 עד 3 דקות לצד",
    tone: "good",
  },
  {
    upTo: 262,
    title: "חם מאוד",
    text: "הקרום נוצר מהר מאוד והשמן מתחיל לעשן. עובד לנתח דק עם שמן מזוקק, אבל הגבול קרוב.",
    time: "דקה עד דקה וחצי",
    tone: "ok",
  },
  {
    upTo: Infinity,
    title: "נשרף",
    text: "מעל אזור ההשחמה הטעם העמוק הופך למר. החוץ שחור לפני שהפנים הספיק להתחמם.",
    time: "פחות מדקה, ואז שחור",
    tone: "bad",
  },
];

function soundOf(temp: number, wet: boolean): string {
  if (wet) return temp < 200 ? "בעבוע ואדים, בלי רחש" : "רחש רטוב ומתיז, הרבה אדים";
  if (temp < 120) return "כמעט שקט";
  if (temp < 160) return "רחש חלש";
  if (temp < 200) return "רחש יציב";
  if (temp < 240) return "רחש חזק ויציב";
  if (temp < 262) return "רחש חד, והשמן מעשן";
  return "פיצוחים ועשן";
}

/**
 * What the pan does to the steak. `surface` is what the meat's outside reaches
 * in the time a dry steak would already have its crust. Wet meat stays near
 * 100°C while the water boils off, so even a very hot pan only gets it to the
 * "too slow" range: it browns late, after the inside has overcooked.
 */
export function simulate(temp: number, wet: boolean) {
  const surface = wet ? (temp < 200 ? Math.min(temp, 105) : 105 + (temp - 200) * 0.6) : temp;
  const zone = ZONES.find((z) => surface < z.upTo)!;
  const look: SteakLook = {
    crust: lerpColor(CRUST, surface),
    center: lerpColor(CENTER, surface),
    greyBand: lerpNumber(
      [
        [80, 1],
        [120, 0.9],
        [160, 0.6],
        [200, 0.25],
        [230, 0.12],
        [270, 0.05],
      ],
      surface,
    ),
    steam: Math.min(
      1,
      lerpNumber(
        [
          [80, 0.75],
          [120, 0.6],
          [160, 0.3],
          [200, 0.1],
          [280, 0.05],
        ],
        surface,
      ) + (wet ? 0.5 : 0),
    ),
    smoke: lerpNumber(
      [
        [235, 0],
        [250, 0.4],
        [280, 1],
      ],
      temp,
    ),
    liquid: wet
      ? temp < 200
        ? 0.85
        : 0.4
      : lerpNumber(
          [
            [80, 0.7],
            [120, 0.5],
            [150, 0.15],
            [170, 0],
          ],
          surface,
        ),
    burntBits: surface >= 262,
  };
  const flavor = lerpNumber(
    [
      [80, 3],
      [120, 8],
      [150, 35],
      [180, 70],
      [215, 100],
      [245, 85],
      [265, 45],
      [280, 20],
    ],
    surface,
  );
  return { surface, zone, look, flavor: Math.round(flavor), sound: soundOf(temp, wet) };
}

const PRESETS = [
  { label: "פושרת", temp: 100 },
  { label: "בינונית", temp: 160 },
  { label: "לוהטת", temp: 215 },
  { label: "יותר מדי", temp: 275 },
];

export function BrowningSim() {
  const theme = useTheme();
  const [temp, setTemp] = useState(215);
  const [wet, setWet] = useState(false);
  const [width, setWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const trackLeft = useRef(0);
  const sim = simulate(temp, wet);

  const toneColor = sim.zone.tone === "good" ? theme.accent : sim.zone.tone === "ok" ? theme.warning : theme.danger;
  const toneSoft = sim.zone.tone === "good" ? theme.accentSoft : sim.zone.tone === "ok" ? theme.warningSoft : theme.primarySoft;

  // The scale is drawn in SVG (never mirrored), so a touch maps straight to a temperature.
  const pad = 14;
  const usable = Math.max(1, width - pad * 2);
  const xOf = (t: number) => pad + ((t - MIN) / (MAX - MIN)) * usable;
  function setFromPage(pageX: number) {
    const ratio = Math.min(1, Math.max(0, (pageX - trackLeft.current - pad) / usable));
    setTemp(Math.round((MIN + ratio * (MAX - MIN)) / 5) * 5);
  }
  function onGrant(e: GestureResponderEvent) {
    const pageX = e.nativeEvent.pageX;
    trackRef.current?.measureInWindow((x) => {
      trackLeft.current = x;
      setFromPage(pageX);
    });
  }

  return (
    <Card style={styles.card}>
      <View style={[styles.stage, { backgroundColor: theme.elevated }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? <SteakArt look={sim.look} width={Math.min(width, 340)} /> : null}
      </View>

      <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <AppText variant="caption" color="textMuted">
            טמפרטורת המחבת
          </AppText>
          <AppText variant="display" style={{ color: toneColor }}>
            {temp}°
          </AppText>
        </View>
        <View style={[styles.zonePill, { backgroundColor: toneSoft }]}>
          <AppText variant="label" style={{ color: toneColor }}>
            {sim.zone.title}
          </AppText>
        </View>
      </Row>

      {/* The scale: zones as coloured bands, the thumb at the chosen temperature. */}
      <View
        ref={trackRef}
        style={styles.track}
        accessibilityRole="adjustable"
        accessibilityLabel="טמפרטורת המחבת"
        accessibilityValue={{ min: MIN, max: MAX, now: temp }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={(e) => setFromPage(e.nativeEvent.pageX)}
      >
        {width > 0 ? (
          <Svg width={width} height={44}>
            <Rect x={xOf(MIN)} y={18} width={xOf(160) - xOf(MIN)} height={8} rx={4} fill={theme.beige} />
            <Rect x={xOf(160)} y={18} width={xOf(200) - xOf(160)} height={8} fill={theme.warning} opacity={0.55} />
            <Rect x={xOf(200)} y={18} width={xOf(240) - xOf(200)} height={8} fill={theme.accent} />
            <Rect x={xOf(240)} y={18} width={xOf(262) - xOf(240)} height={8} fill={theme.warning} opacity={0.55} />
            <Rect x={xOf(262)} y={18} width={xOf(MAX) - xOf(262)} height={8} rx={4} fill={theme.danger} opacity={0.7} />
            <Circle cx={xOf(temp)} cy={22} r={13} fill={theme.card} stroke={toneColor} strokeWidth={4} />
          </Svg>
        ) : null}
      </View>
      <Row style={{ gap: 6, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <Chip key={p.label} label={`${p.label} ${p.temp}°`} selected={temp === p.temp} onPress={() => setTemp(p.temp)} />
        ))}
      </Row>

      <Row style={{ gap: 6 }}>
        <Chip label="בשר יבש" emoji="🧻" selected={!wet} onPress={() => setWet(false)} />
        <Chip label="בשר רטוב" emoji="💧" selected={wet} onPress={() => setWet(true)} />
      </Row>

      {wet ? (
        <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
          <AppText variant="caption" style={{ color: theme.warning }}>
            כל עוד יש מים על המשטח הוא תקוע ב-100 מעלות, והחום של המחבת הולך על אידוי. לכן המשטח מגיע עכשיו רק ל-{Math.round(sim.surface)}° בערך,
            ואותה מחבת נותנת תוצאה של מחבת קרה בהרבה.
          </AppText>
        </View>
      ) : null}

      <AppText>{sim.zone.text}</AppText>

      <View style={{ gap: 8 }}>
        <Row style={styles.fact}>
          <AppText variant="caption" color="textMuted" style={styles.factLabel}>
            זמן עד קרום
          </AppText>
          <AppText variant="label" style={{ flex: 1 }}>
            {sim.zone.time}
          </AppText>
        </Row>
        <Row style={styles.fact}>
          <AppText variant="caption" color="textMuted" style={styles.factLabel}>
            מה שומעים
          </AppText>
          <AppText variant="label" style={{ flex: 1 }}>
            {sim.sound}
          </AppText>
        </Row>
        <Row style={styles.fact}>
          <AppText variant="caption" color="textMuted" style={styles.factLabel}>
            טעם שנוצר
          </AppText>
          <View style={[styles.bar, { backgroundColor: theme.elevated }]}>
            <View style={[styles.barFill, { width: `${sim.flavor}%`, backgroundColor: toneColor }]} />
          </View>
        </Row>
      </View>

      <AppText variant="caption" color="textMuted">
        בחתך: המסגרת היא הקרום, השכבה האפורה היא בשר שהתבשל יותר מדי, והמרכז הוורוד הוא מה שרוצים לשמור.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md, gap: Spacing.sm + 4 },
  stage: { borderRadius: Radius.md, alignItems: "center", paddingVertical: Spacing.sm },
  zonePill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.pill, marginBottom: 6 },
  // touchAction/userSelect/cursor are web-only style keys: a drag moves the thumb instead of scrolling or selecting.
  track: { height: 44, justifyContent: "center", ...({ touchAction: "none", userSelect: "none", cursor: "pointer" } as object) },
  note: { padding: Spacing.sm + 2, borderRadius: Radius.sm },
  fact: { gap: Spacing.sm },
  factLabel: { width: 84 },
  bar: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5 },
});
