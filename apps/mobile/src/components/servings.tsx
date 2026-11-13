import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppText, Button, Chip, IconButton, Row } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dialog } from "@/lib/dialog";
import { formatQuantity } from "@/lib/format";

/**
 * The servings calculator: a pill with − / + around the current number of
 * servings; tapping the number opens a sheet with the usual jumps (half,
 * the original, ×1.5, ×2, ×3), a free number, and a reset. Every quantity in
 * the recipe follows the factor between `current` and `base`.
 *
 * When the recipe does not say how many it serves, the pill asks for that
 * number first and `onSetBase` saves it on the recipe, so the calculator works
 * for every recipe after one answer.
 */
export function ServingsControl({
  base,
  current,
  onChange,
  onSetBase,
  compact,
}: {
  base: number | null;
  current: number | null;
  onChange: (servings: number | null) => void;
  onSetBase?: (servings: number) => void;
  /** Smaller pill for a header row. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  async function askBase() {
    const answer = await dialog.prompt("לכמה מנות המתכון המקורי?", "4");
    const n = answer ? Number(answer.replace(",", ".")) : NaN;
    if (!Number.isNaN(n) && n > 0) onSetBase?.(n);
  }

  async function askNumber() {
    const answer = await dialog.prompt("לכמה מנות לחשב?", String(current ?? base ?? ""));
    const n = answer ? Number(answer.replace(",", ".")) : NaN;
    if (!Number.isNaN(n) && n > 0) {
      onChange(n === base ? null : n);
      setOpen(false);
    }
  }

  if (!base) {
    return (
      <Pressable
        onPress={askBase}
        style={[styles.pill, compact && styles.pillCompact, { borderColor: theme.border, backgroundColor: theme.card }]}
      >
        <Ionicons name="people-outline" size={16} color={theme.textSecondary} />
        <AppText variant="label" color="textSecondary">
          כמה מנות?
        </AppText>
      </Pressable>
    );
  }

  const value = current ?? base;
  const factor = value / base;
  const changed = Math.abs(factor - 1) > 0.001;

  const step = (dir: 1 | -1) => {
    // Whole steps above 1; below that, half steps so 1 → ½ (and back) is possible.
    const next =
      dir > 0
        ? value < 1
          ? 1
          : Math.round(value) + 1
        : value > 1
          ? Math.max(1, Math.round(value) - 1)
          : Math.max(0.5, value - 0.5);
    onChange(next === base ? null : next);
  };

  return (
    <>
      <Row
        style={[
          styles.pill,
          compact && styles.pillCompact,
          { borderColor: changed ? theme.primary : theme.border, backgroundColor: changed ? theme.primarySoft : theme.card },
        ]}
      >
        <IconButton icon="remove" size={18} onPress={() => step(-1)} accessibilityLabel="פחות מנות" />
        <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ minWidth: 64, alignItems: "center" }}>
          <Text style={[styles.value, { color: changed ? theme.primary : theme.text }]}>
            {formatQuantity(value)} מנות
          </Text>
          {changed ? (
            <Text style={[styles.sub, { color: theme.textMuted }]}>
              ×{formatQuantity(Math.round(factor * 100) / 100)} מהמקור ({formatQuantity(base)})
            </Text>
          ) : null}
        </Pressable>
        <IconButton icon="add" size={18} onPress={() => step(1)} accessibilityLabel="יותר מנות" />
      </Row>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: theme.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.card }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />
            <AppText variant="heading">לכמה מנות?</AppText>
            <AppText variant="caption" color="textSecondary">
              המתכון המקורי יוצא {formatQuantity(base)} מנות. הכמויות במצרכים ובשלבים יחושבו מחדש ויעוגלו למידות נוחות.
            </AppText>
            <Row style={{ gap: Spacing.sm, flexWrap: "wrap" }}>
              {[
                { label: "חצי", f: 0.5 },
                { label: "המקור", f: 1 },
                { label: "×1.5", f: 1.5 },
                { label: "×2", f: 2 },
                { label: "×3", f: 3 },
                { label: "×4", f: 4 },
              ].map((o) => (
                <Chip
                  key={o.label}
                  label={`${o.label} · ${formatQuantity(base * o.f)}`}
                  selected={Math.abs(factor - o.f) < 0.001}
                  onPress={() => {
                    onChange(o.f === 1 ? null : base * o.f);
                    setOpen(false);
                  }}
                />
              ))}
            </Row>
            <Row style={{ gap: Spacing.sm }}>
              <Button title="מספר אחר..." icon="calculator-outline" variant="secondary" onPress={askNumber} style={{ flex: 1 }} />
              {onSetBase ? (
                <Button
                  title="לתקן את המקור"
                  variant="ghost"
                  size="sm"
                  onPress={async () => {
                    setOpen(false);
                    await askBase();
                  }}
                />
              ) : null}
            </Row>
            <View style={[styles.tip, { backgroundColor: theme.elevated }]}>
              <AppText variant="caption" color="textSecondary">
                💡 כשמכפילים מתכון: זמני אפייה ובישול לא מוכפלים (בודקים מוכנות), תבנית גדולה יותר או שתי תבניות, ותבלינים ומלח
                מוסיפים בהדרגה לפי הטעם.
              </AppText>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** One line under a scaled ingredient list that says what was done. */
export function ScaledNote({ base, current }: { base: number | null; current: number | null }) {
  const theme = useTheme();
  if (!base || !current || Math.abs(current / base - 1) < 0.001) return null;
  const up = current > base;
  return (
    <Row style={[styles.note, { backgroundColor: theme.primarySoft }]}>
      <Ionicons name="calculator-outline" size={16} color={theme.primary} />
      <AppText variant="caption" color="primary" style={{ flex: 1 }}>
        הכמויות מותאמות ל-{formatQuantity(current)} מנות (במקור {formatQuantity(base)}).{" "}
        {up ? "זמני הבישול לא גדלים באותו יחס, ותבלינים לפי הטעם." : "תבנית קטנה יותר, וזמני האפייה כמעט לא משתנים."}
      </AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  pillCompact: { paddingVertical: 2 },
  value: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 18 },
  sub: { fontFamily: Fonts.medium, fontSize: 10, lineHeight: 12 },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: Spacing.xs },
  tip: { padding: Spacing.sm + 4, borderRadius: Radius.md },
  note: { gap: Spacing.sm, padding: Spacing.sm + 2, borderRadius: Radius.md, alignItems: "flex-start" },
});
