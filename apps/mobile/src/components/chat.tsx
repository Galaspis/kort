import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Chip } from "@/components/ui";
import { Fonts, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface ChatLine {
  role: "user" | "assistant";
  text: string;
}

/**
 * A conversation with Kort: bubbles, optional tappable answers under the last
 * message, and a text box. Used by the lesson's "ask a question" and by
 * "לבשל עם קורט". `children` render after the bubbles (a proposal card, a result).
 */
export function Chat({
  lines,
  options = [],
  busy,
  busyLabel = "קורט חושב…",
  error,
  placeholder = "כתבו כאן…",
  onSend,
  children,
}: {
  lines: ChatLine[];
  options?: string[];
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  placeholder?: string;
  onSend: (text: string) => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [lines.length, busy, options.length, error]);

  function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setDraft("");
    onSend(clean);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.top + 44}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {lines.map((line, i) => {
          const mine = line.role === "user";
          return (
            <View
              key={i}
              style={[
                styles.bubble,
                mine
                  ? { alignSelf: "flex-start", backgroundColor: theme.primary, borderBottomStartRadius: 6 }
                  : { alignSelf: "flex-end", backgroundColor: theme.card, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth, borderBottomEndRadius: 6 },
              ]}
            >
              <AppText style={mine ? { color: theme.onPrimary } : undefined}>{line.text}</AppText>
            </View>
          );
        })}
        {busy ? (
          <View style={[styles.bubble, styles.busy, { alignSelf: "flex-end", backgroundColor: theme.card, borderColor: theme.border }]}>
            <ActivityIndicator size="small" color={theme.primary} />
            <AppText variant="caption" color="textMuted">
              {busyLabel}
            </AppText>
          </View>
        ) : null}
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.primarySoft }]}>
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          </View>
        ) : null}
        {children}
        {!busy && options.length ? (
          <View style={styles.options}>
            {options.map((o) => (
              <Chip key={o} label={o} onPress={() => send(o)} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputRow, { borderTopColor: theme.border, backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.sm }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          multiline
          onSubmitEditing={() => send(draft)}
          // Enter sends on a keyboard; Shift+Enter makes a new line.
          onKeyPress={(e) => {
            const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
            if (Platform.OS === "web" && key.key === "Enter" && !key.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          style={[styles.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={busy || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="שליחה"
          style={[styles.send, { backgroundColor: theme.primary, opacity: busy || !draft.trim() ? 0.4 : 1 }]}
        >
          <Ionicons name="arrow-up" size={22} color={theme.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.lg },
  bubble: { maxWidth: "88%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: Radius.md },
  busy: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: StyleSheet.hairlineWidth },
  error: { padding: Spacing.sm + 2, borderRadius: Radius.sm },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 130,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
    fontFamily: Fonts.regular,
    textAlign: "right",
    writingDirection: "rtl",
  },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
});
