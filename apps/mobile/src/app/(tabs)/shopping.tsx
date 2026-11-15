import { Ionicons } from "@expo/vector-icons";
import {
  AISLES,
  formatListDate,
  shoppingListLabel,
  type ShoppingItemRow,
  type ShoppingListSummary,
} from "@recipe/shared";
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import {
  AppText,
  Button,
  EmptyState,
  IconButton,
  Loading,
  Row,
  Screen,
} from "@/components/ui";
import { ScrollJumper, useScrollJumper } from "@/components/scroll-jumper";
import {
  AISLE_EMOJI,
  Fonts,
  Radius,
  Shadows,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dialog } from "@/lib/dialog";
import { formatQuantity, parseIngredientLine } from "@/lib/format";
import { itemEmoji } from "@/lib/ingredients";
import {
  useAddShoppingItems,
  useCreateShoppingList,
  useDeleteShoppingItems,
  useDeleteShoppingList,
  useFinishShoppingList,
  useMoveShoppingItem,
  useRenameShoppingList,
  useSetUnavailable,
  useShoppingItems,
  useShoppingLists,
  useToggleShoppingItem,
} from "@/lib/queries";
import { shareText, shareToWhatsApp, shoppingToText } from "@/lib/share";

const DONE = "נקנה";
const MISSING = "לא היה בסופר";
const MANUAL = "הוספתי בעצמי";
type GroupBy = "recipe" | "aisle";

/** What a list is, in one word, for the navigator and the lists sheet. */
function listStatus(list: ShoppingListSummary, currentId: string | undefined) {
  if (list.status === "done") return { label: "נקנתה", tone: "muted" as const };
  if (list.id === currentId) return { label: "הרשימה הנוכחית", tone: "accent" as const };
  return { label: "לפעם הבאה", tone: "primary" as const };
}

export default function ShoppingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const lists = useShoppingLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<SectionList<ShoppingItemRow>>(null);
  const jumper = useScrollJumper();

  // Lists come sorted oldest → newest: history, then the current list, then future ones.
  const sorted = useMemo(() => lists.data ?? [], [lists.data]);
  const current = sorted.find((l) => l.status === "open");
  const viewed = (selectedId && sorted.find((l) => l.id === selectedId)) || current;
  const viewedId = viewed?.id ?? null;
  const viewedIndex = viewed ? sorted.findIndex((l) => l.id === viewed.id) : -1;
  const isOpen = viewed?.status !== "done";
  const isCurrent = Boolean(viewed && current && viewed.id === current.id);

  const { data, isLoading } = useShoppingItems(viewedId);
  const toggle = useToggleShoppingItem(viewedId);
  const setUnavailable = useSetUnavailable(viewedId);
  const move = useMoveShoppingItem();
  const add = useAddShoppingItems();
  const remove = useDeleteShoppingItems();
  const createList = useCreateShoppingList();
  const renameList = useRenameShoppingList();
  const deleteList = useDeleteShoppingList();
  const finishList = useFinishShoppingList();

  const [draft, setDraft] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("recipe");
  const [menuItem, setMenuItem] = useState<ShoppingItemRow | null>(null);
  const [listsOpen, setListsOpen] = useState(false);

  const sections = useMemo(() => {
    const items = data ?? [];
    const open = items.filter((i) => !i.checked && !i.unavailable);
    const missing = items.filter((i) => i.unavailable);
    const done = items.filter((i) => i.checked && !i.unavailable);
    const groups = new Map<string, ShoppingItemRow[]>();
    for (const item of open) {
      const key =
        groupBy === "recipe"
          ? (item.recipe_title ?? MANUAL)
          : (item.aisle ?? "אחר");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    let ordered: { title: string; data: ShoppingItemRow[] }[];
    if (groupBy === "aisle") {
      ordered = [...AISLES]
        .filter((a) => groups.has(a))
        .map((a) => ({ title: a, data: groups.get(a)! }));
      for (const [key, list] of groups)
        if (!(AISLES as readonly string[]).includes(key))
          ordered.push({ title: key, data: list });
    } else {
      ordered = [...groups.entries()]
        .sort(([a], [b]) =>
          a === MANUAL ? 1 : b === MANUAL ? -1 : a.localeCompare(b, "he"),
        )
        .map(([title, list]) => ({ title, data: list }));
    }
    if (missing.length) ordered.push({ title: MISSING, data: missing });
    if (done.length) ordered.push({ title: DONE, data: done });
    return ordered;
  }, [data, groupBy]);

  const items = data ?? [];
  const openCount = items.filter((i) => !i.checked && !i.unavailable).length;
  const doneCount = items.filter((i) => i.checked && !i.unavailable).length;
  const missingCount = items.filter((i) => i.unavailable).length;
  const checkedIds = items.filter((i) => i.checked).map((i) => i.id);

  function submitDraft() {
    const text = draft.trim();
    if (!text || !viewed) return;
    const parsed = parseIngredientLine(text);
    add.mutate([
      {
        name: parsed.name,
        quantity: parsed.quantity,
        unit: parsed.unit,
        aisle: parsed.aisle,
        list_id: viewed.id,
      },
    ]);
    setDraft("");
  }

  async function clearAll() {
    const ok = await dialog.confirm("לנקות את כל הרשימה?", undefined, {
      confirmText: "נקה",
      destructive: true,
    });
    if (ok) remove.mutate(items.map((i) => i.id));
  }

  async function finish() {
    if (!viewed) return;
    const ok = await dialog.confirm(
      "לסיים את הקנייה?",
      "מה שנקנה ומה שלא היה בסופר יישמרו ברשימה של היום. כל השאר עובר לרשימה הבאה.",
      { confirmText: "סיום קנייה" },
    );
    if (!ok) return;
    await finishList.mutateAsync(viewed.id);
    setSelectedId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function rename() {
    if (!viewed) return;
    const title = await dialog.prompt(
      "שם לרשימה (ריק = התאריך)",
      viewed.title ?? "",
    );
    if (title === null) return;
    renameList.mutate({ id: viewed.id, title: title.trim() || null });
  }

  async function removeList() {
    if (!viewed) return;
    const ok = await dialog.confirm(
      `למחוק את הרשימה ${shoppingListLabel(viewed)}?`,
      viewed.total ? `${viewed.total} פריטים יימחקו איתה.` : undefined,
      { confirmText: "מחיקה", destructive: true },
    );
    if (!ok) return;
    await deleteList.mutateAsync(viewed.id);
    setSelectedId(null);
  }

  async function newList() {
    const created = await createList.mutateAsync(null);
    setSelectedId(created.id);
  }

  function sectionEmoji(title: string) {
    if (title === DONE) return "✅";
    if (title === MISSING) return "🚫";
    if (groupBy === "aisle") return AISLE_EMOJI[title] ?? "🛒";
    return title === MANUAL ? "✍️" : "🍳";
  }

  /** The "⋯" menu for one item. */
  function itemActions(item: ShoppingItemRow): SheetAction[] {
    const actions: SheetAction[] = [];
    if (isOpen) {
      actions.push(
        item.unavailable
          ? {
              emoji: "✅",
              label: "בעצם היה בסופר",
              run: () => setUnavailable.mutate({ item, value: false }),
            }
          : {
              emoji: "🚫",
              label: "לא היה בסופר (יופיע ברשימה הבאה)",
              run: () => setUnavailable.mutate({ item, value: true }),
            },
      );
      if (!item.unavailable && isCurrent) {
        const next = sorted.find(
          (l) => l.status === "open" && l.id !== viewed?.id,
        );
        actions.push({
          icon: "arrow-redo-outline",
          label: next
            ? `העברה לרשימה הבאה (${shoppingListLabel(next)})`
            : "העברה לרשימה הבאה",
          run: async () => {
            const target = next ?? (await createList.mutateAsync(null));
            move.mutate({ id: item.id, listId: target.id });
          },
        });
      }
    } else if (current) {
      actions.push({
        icon: "cart-outline",
        label: "החזרה לרשימה הנוכחית",
        run: () => move.mutate({ id: item.id, listId: current.id }),
      });
    }
    actions.push({
      icon: "trash-outline",
      label: "מחיקה מהרשימה",
      color: theme.danger,
      run: () => remove.mutate([item.id]),
    });
    return actions;
  }

  const status = viewed ? listStatus(viewed, current?.id) : null;
  const statusColor =
    status?.tone === "accent"
      ? theme.accent
      : status?.tone === "primary"
        ? theme.primary
        : theme.textMuted;

  return (
    <Screen>
      <SectionList
        ref={listRef}
        onScroll={jumper.onScroll}
        scrollEventThrottle={100}
        sections={sections}
        keyExtractor={(i) => i.id}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + Spacing.md },
        ]}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: Spacing.md, marginBottom: Spacing.sm }}>
            <Row style={{ justifyContent: "space-between" }}>
              <View>
                <AppText variant="display">רשימת קניות</AppText>
                {items.length ? (
                  <AppText variant="caption" color="textSecondary">
                    {isOpen
                      ? openCount
                        ? `${openCount} פריטים לקנות`
                        : "הכול נקנה 🎉"
                      : `${doneCount} נקנו`}
                    {isOpen && doneCount ? ` · ${doneCount} בעגלה` : ""}
                    {missingCount ? ` · ${missingCount} לא היו בסופר` : ""}
                  </AppText>
                ) : null}
              </View>
              {openCount ? (
                <Row style={{ gap: Spacing.xs }}>
                  <Pressable
                    onPress={() => shareToWhatsApp(shoppingToText(items))}
                    accessibilityLabel="שליחה בוואטסאפ"
                    style={[styles.whatsapp, Shadows.card]}
                  >
                    <Ionicons name="logo-whatsapp" size={22} color="#fff" />
                  </Pressable>
                  <IconButton
                    icon="share-outline"
                    circle
                    onPress={() => shareText(shoppingToText(items))}
                  />
                </Row>
              ) : null}
            </Row>

            {/* Which list: ‹ older | today's date | newer › */}
            {viewed ? (
              <Row
                style={[
                  styles.navigator,
                  Shadows.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <IconButton
                  icon="chevron-forward"
                  color={viewedIndex > 0 ? "text" : "textMuted"}
                  disabled={viewedIndex <= 0}
                  accessibilityLabel="רשימה קודמת"
                  onPress={() => setSelectedId(sorted[viewedIndex - 1]!.id)}
                />
                <Pressable
                  onPress={() => setListsOpen(true)}
                  style={{ flex: 1, alignItems: "center" }}
                  accessibilityLabel="כל הרשימות"
                >
                  <Row style={{ gap: 6 }}>
                    <AppText variant="subheading" numberOfLines={1}>
                      {shoppingListLabel(viewed)}
                    </AppText>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={theme.textMuted}
                    />
                  </Row>
                  <AppText
                    variant="caption"
                    style={{ color: statusColor }}
                  >
                    {status?.label}
                    {viewed.title ? ` · ${formatListDate(viewed)}` : ""}
                  </AppText>
                </Pressable>
                <IconButton
                  icon="chevron-back"
                  color={
                    viewedIndex < sorted.length - 1 ? "text" : "textMuted"
                  }
                  disabled={viewedIndex >= sorted.length - 1}
                  accessibilityLabel="רשימה הבאה"
                  onPress={() => setSelectedId(sorted[viewedIndex + 1]!.id)}
                />
              </Row>
            ) : null}

            {isOpen ? (
              <Row
                style={[
                  styles.addRow,
                  Shadows.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={submitDraft}
                  placeholder="הוספה לרשימה, למשל: 15 מלפפון"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.addInput, { color: theme.text }]}
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
                <Pressable
                  onPress={submitDraft}
                  style={[styles.addButton, { backgroundColor: theme.primary }]}
                >
                  <Ionicons name="add" size={22} color={theme.onPrimary} />
                </Pressable>
              </Row>
            ) : (
              <AppText variant="caption" color="textSecondary">
                רשימה שהסתיימה: מה שנקנה ומה שלא היה בסופר. מה שנשאר עבר
                לרשימה הבאה.
              </AppText>
            )}

            {openCount > 1 ? (
              <Row
                style={[styles.segment, { backgroundColor: theme.elevated }]}
              >
                {(
                  [
                    ["recipe", "לפי מתכון"],
                    ["aisle", "לפי מחלקה בסופר"],
                  ] as [GroupBy, string][]
                ).map(([key, label]) => {
                  const on = groupBy === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setGroupBy(key)}
                      style={[
                        styles.segmentItem,
                        on && { backgroundColor: theme.card, ...Shadows.card },
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          {
                            color: on ? theme.text : theme.textSecondary,
                            fontFamily: on ? Fonts.bold : Fonts.medium,
                          },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Row style={styles.sectionHeader}>
            <Text style={{ fontSize: 16 }}>{sectionEmoji(section.title)}</Text>
            <AppText
              variant="label"
              color="textSecondary"
              style={{ flexShrink: 1 }}
              numberOfLines={1}
            >
              {section.title}
            </AppText>
            <AppText variant="caption" color="textMuted">
              {section.data.length}
            </AppText>
            {section.title === DONE && isOpen ? (
              <Pressable
                onPress={() => remove.mutate(checkedIds)}
                style={{ marginStart: "auto" }}
              >
                <AppText variant="caption" color="primary">
                  הסרת מה שנקנה
                </AppText>
              </Pressable>
            ) : null}
          </Row>
        )}
        renderItem={({ item }) => {
          const dim = item.checked || item.unavailable;
          return (
            <Pressable
              onPress={() => {
                if (item.unavailable || !isOpen) {
                  setMenuItem(item);
                  return;
                }
                Haptics.selectionAsync();
                toggle.mutate(item);
              }}
              onLongPress={() => setMenuItem(item)}
              style={({ pressed }) => [
                styles.item,
                !dim && Shadows.card,
                {
                  backgroundColor: dim ? "transparent" : theme.card,
                  borderColor: theme.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.check,
                  {
                    borderColor: item.unavailable
                      ? theme.textMuted
                      : item.checked
                        ? theme.accent
                        : theme.beige,
                    backgroundColor: item.checked
                      ? theme.accent
                      : "transparent",
                  },
                ]}
              >
                {item.unavailable ? (
                  <Ionicons name="close" size={16} color={theme.textMuted} />
                ) : item.checked ? (
                  <Ionicons name="checkmark" size={16} color="#fff" />
                ) : null}
              </View>
              <Text style={{ fontSize: 22, opacity: dim ? 0.5 : 1 }}>
                {itemEmoji(item.name, item.aisle, item.emoji)}
              </Text>
              <View style={{ flex: 1 }}>
                <AppText
                  style={
                    dim && {
                      textDecorationLine: item.checked
                        ? "line-through"
                        : "none",
                      color: theme.textMuted,
                    }
                  }
                >
                  {item.name}
                </AppText>
                {item.unavailable ? (
                  <AppText variant="caption" color="textMuted">
                    לא היה בסופר · ברשימה הבאה
                  </AppText>
                ) : groupBy === "aisle" && item.recipe_title ? (
                  <AppText variant="caption" color="textMuted">
                    {item.recipe_title}
                  </AppText>
                ) : groupBy === "recipe" && item.aisle ? (
                  <AppText variant="caption" color="textMuted">
                    {item.aisle}
                  </AppText>
                ) : null}
              </View>
              {item.quantity !== null || item.unit ? (
                <View
                  style={[
                    styles.qty,
                    {
                      backgroundColor: dim ? "transparent" : theme.primarySoft,
                      borderColor: dim ? theme.border : "transparent",
                    },
                  ]}
                >
                  {item.quantity !== null ? (
                    <Text
                      style={[
                        styles.qtyNumber,
                        { color: dim ? theme.textMuted : theme.primaryDark },
                      ]}
                    >
                      {formatQuantity(item.quantity)}
                    </Text>
                  ) : null}
                  {item.unit ? (
                    <Text
                      style={[
                        styles.qtyUnit,
                        { color: dim ? theme.textMuted : theme.textSecondary },
                      ]}
                    >
                      {item.unit}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <IconButton
                icon="ellipsis-vertical"
                size={18}
                color="textMuted"
                accessibilityLabel="אפשרויות"
                onPress={() => setMenuItem(item)}
                style={{ marginStart: -4 }}
              />
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          isLoading || lists.isLoading ? (
            <Loading />
          ) : (
            <EmptyState
              emoji="🛒"
              title="הרשימה ריקה"
              subtitle={
                isOpen
                  ? "פותחים מתכון ולוחצים 'הוסף לרשימת קניות', או מקלידים למעלה"
                  : "לא נשמר כלום ברשימה הזאת"
              }
            />
          )
        }
        ListFooterComponent={
          items.length ? (
            <View style={{ gap: Spacing.sm, marginTop: Spacing.lg }}>
              {isOpen && (doneCount || missingCount) ? (
                <Button
                  title="סיום קנייה"
                  icon="checkmark-done-outline"
                  loading={finishList.isPending}
                  onPress={finish}
                />
              ) : null}
              <Row style={{ gap: Spacing.sm, justifyContent: "center" }}>
                <Button
                  title="ניקוי הרשימה"
                  icon="trash-outline"
                  variant="ghost"
                  size="sm"
                  onPress={clearAll}
                />
              </Row>
            </View>
          ) : null
        }
      />

      <ScrollJumper state={jumper.state} target={listRef} bottom={insets.bottom + 96} />

      {/* One item's menu */}
      <ActionSheet
        visible={menuItem !== null}
        title={menuItem?.name}
        subtitle={
          menuItem && (menuItem.quantity !== null || menuItem.unit)
            ? [formatQuantity(menuItem.quantity), menuItem.unit]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
        actions={menuItem ? itemActions(menuItem) : []}
        onClose={() => setMenuItem(null)}
      />

      {/* All lists: history, current, future */}
      <ActionSheet
        visible={listsOpen}
        title="הרשימות שלנו"
        onClose={() => setListsOpen(false)}
        actions={[
          {
            icon: "add-circle-outline",
            label: "רשימה חדשה לפעם הבאה",
            run: newList,
          },
          ...(viewed
            ? [
                { icon: "create-outline", label: "שינוי שם הרשימה", run: rename },
                {
                  icon: "trash-outline",
                  label: `מחיקת הרשימה ${shoppingListLabel(viewed)}`,
                  color: theme.danger,
                  run: removeList,
                },
              ]
            : []),
        ] as SheetAction[]}
      >
        <View style={{ gap: 6, marginVertical: Spacing.sm }}>
          {[...sorted].reverse().map((list) => {
            const s = listStatus(list, current?.id);
            const on = list.id === viewed?.id;
            const color =
              s.tone === "accent"
                ? theme.accent
                : s.tone === "primary"
                  ? theme.primary
                  : theme.textMuted;
            return (
              <Pressable
                key={list.id}
                onPress={() => {
                  setSelectedId(list.id);
                  setListsOpen(false);
                }}
                style={[
                  styles.listRow,
                  {
                    backgroundColor: on ? theme.elevated : "transparent",
                    borderColor: on ? theme.beige : theme.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 20 }}>
                  {list.status === "done" ? "🧾" : on ? "🛒" : "🗓️"}
                </Text>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyBold" numberOfLines={1}>
                    {shoppingListLabel(list)}
                  </AppText>
                  <AppText variant="caption" style={{ color }}>
                    {s.label}
                    {list.title ? ` · ${formatListDate(list)}` : ""}
                  </AppText>
                </View>
                <AppText variant="caption" color="textMuted">
                  {list.status === "done"
                    ? `${list.checked} נקנו${list.unavailable ? ` · ${list.unavailable} חסרו` : ""}`
                    : `${list.total - list.checked - list.unavailable} לקנות`}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </ActionSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.md, paddingBottom: 120, flexGrow: 1 },
  whatsapp: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#25D366",
    alignItems: "center",
    justifyContent: "center",
  },
  navigator: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: "space-between",
  },
  addRow: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingStart: 18,
    paddingEnd: 5,
    height: 54,
    gap: Spacing.sm,
  },
  addInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Fonts.regular,
    textAlign: "right",
    writingDirection: "rtl",
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  segment: { borderRadius: Radius.pill, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  segmentText: { fontSize: 14 },
  sectionHeader: { gap: 8, marginTop: Spacing.md, marginBottom: Spacing.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 2,
    paddingVertical: 8,
    paddingStart: 12,
    paddingEnd: 4,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  qty: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    minWidth: 36,
    justifyContent: "center",
  },
  qtyNumber: { fontSize: 16, fontFamily: Fonts.bold },
  qtyUnit: { fontSize: 12, fontFamily: Fonts.medium },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm + 2,
    padding: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
