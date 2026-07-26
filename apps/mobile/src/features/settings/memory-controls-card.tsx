import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import {
  coachMemoryListResponseSchema,
  coachMemoryResponseSchema,
  type CoachMemory,
  type CoachMemoryKind,
  type CoachMemoryListResponse,
  type CoachMemoryResponse,
  type CoachMemorySummary,
} from "@mizyun/contracts";

import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";

const kinds: readonly [CoachMemoryKind, string][] = [
  ["preference", "Preference"],
  ["constraint", "Constraint"],
  ["goal", "Goal"],
  ["profile", "Profile"],
  ["observation", "Observation"],
  ["summary", "Summary"],
];

const expiryChoices: ReadonlyArray<readonly [number | null, string]> = [
  [null, "No expiry"],
  [30, "30 days"],
  [90, "90 days"],
];

const expiryFrom = (days: number | null): string | null =>
  days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();

export function MemoryControlsCard() {
  const [memories, setMemories] = useState<readonly CoachMemorySummary[]>([]);
  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState<CoachMemoryKind>("preference");
  const [newExpiryDays, setNewExpiryDays] = useState<number | null>(null);
  const [editing, setEditing] = useState<CoachMemory | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await apiClient.request<CoachMemoryListResponse>({
      method: "GET",
      path: "/v1/coach/memories?includeSuperseded=true",
      schema: coachMemoryListResponseSchema,
    });
    if (result.ok) {
      setMemories(result.value.memories);
    } else {
      setMessage("Coach memories could not be loaded.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const content = newContent.trim();
    if (content.length === 0) return;
    setBusyId("new");
    const result = await apiClient.request<CoachMemoryResponse>({
      method: "POST",
      path: "/v1/coach/memories",
      body: {
        kind: newKind,
        content,
        importance: 5,
        expiresAt: expiryFrom(newExpiryDays),
      },
      schema: coachMemoryResponseSchema,
    });
    if (result.ok) {
      setNewContent("");
      setMessage(
        "Memory candidate saved. Confirm it before Coach can recall it.",
      );
      await refresh();
    } else {
      setMessage("The memory candidate could not be saved.");
    }
    setBusyId(null);
  };

  const patch = async (
    id: string,
    body: Readonly<Record<string, unknown>>,
    successMessage: string,
  ) => {
    setBusyId(id);
    const result = await apiClient.request<CoachMemoryResponse>({
      method: "PATCH",
      path: `/v1/coach/memories/${id}`,
      body,
      schema: coachMemoryResponseSchema,
    });
    setMessage(result.ok ? successMessage : "The memory could not be changed.");
    if (result.ok) {
      setEditing(null);
      setEditContent("");
      await refresh();
    }
    setBusyId(null);
  };

  const beginEdit = async (id: string) => {
    setBusyId(id);
    const result = await apiClient.request<CoachMemoryResponse>({
      method: "GET",
      path: `/v1/coach/memories/${id}`,
      schema: coachMemoryResponseSchema,
    });
    if (result.ok) {
      setEditing(result.value.memory);
      setEditContent(result.value.memory.content);
    } else {
      setMessage("The full memory could not be loaded.");
    }
    setBusyId(null);
  };

  const remove = (memory: CoachMemorySummary) => {
    Alert.alert(
      "Delete this Coach memory?",
      "This permanently removes the memory. Coach will no longer recall it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusyId(memory.id);
              const result = await apiClient.request({
                method: "DELETE",
                path: `/v1/coach/memories/${memory.id}`,
              });
              setMessage(
                result.ok
                  ? "Memory deleted."
                  : "The memory could not be deleted.",
              );
              if (result.ok) await refresh();
              setBusyId(null);
            })();
          },
        },
      ],
    );
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Coach memory</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Mizyun recalls only memories you confirm. Candidates, deactivated items,
        low-confidence items, and expired items stay out of the Coach prompt.
      </ThemedText>

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Add a candidate
        </ThemedText>
        <View style={styles.chips}>
          {kinds.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={newKind === value}
              onPress={() => setNewKind(value)}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel="New Coach memory"
          maxLength={4_000}
          multiline
          placeholder="Something you explicitly want Coach to remember…"
          placeholderTextColor={Colors.dark.textSecondary}
          value={newContent}
          onChangeText={setNewContent}
          style={styles.input}
        />
        <View style={styles.chips}>
          {expiryChoices.map(([days, label]) => (
            <Chip
              key={label}
              label={label}
              selected={newExpiryDays === days}
              onPress={() => setNewExpiryDays(days)}
            />
          ))}
        </View>
        <ActionButton
          label={busyId === "new" ? "Saving…" : "Save candidate"}
          disabled={busyId !== null || newContent.trim().length === 0}
          primary
          onPress={() => void create()}
        />
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Saved memories
        </ThemedText>
        {loading ? (
          <ThemedText type="small">Loading…</ThemedText>
        ) : memories.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No Coach memories yet.
          </ThemedText>
        ) : (
          memories.map((memory) => (
            <View key={memory.id} style={styles.memory}>
              <View style={styles.memoryHeading}>
                <ThemedText type="smallBold">
                  {memory.kind} · {memory.status}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  importance {memory.importance}
                </ThemedText>
              </View>
              <ThemedText type="small">{memory.preview}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {memory.expiresAt === null
                  ? "No expiry"
                  : `Expires ${memory.expiresAt.slice(0, 10)}`}
              </ThemedText>
              <View style={styles.actions}>
                {memory.status === "candidate" ? (
                  <ActionButton
                    label="Confirm"
                    disabled={busyId !== null}
                    onPress={() =>
                      void patch(
                        memory.id,
                        { status: "active" },
                        "Memory confirmed. Coach may now recall it.",
                      )
                    }
                  />
                ) : memory.status === "active" ? (
                  <ActionButton
                    label="Deactivate"
                    disabled={busyId !== null}
                    onPress={() =>
                      void patch(
                        memory.id,
                        { status: "superseded" },
                        "Memory deactivated.",
                      )
                    }
                  />
                ) : (
                  <ActionButton
                    label="Reactivate"
                    disabled={busyId !== null}
                    onPress={() =>
                      void patch(
                        memory.id,
                        { status: "active" },
                        "Memory reactivated.",
                      )
                    }
                  />
                )}
                <ActionButton
                  label="Correct"
                  disabled={busyId !== null}
                  onPress={() => void beginEdit(memory.id)}
                />
                <ActionButton
                  label={memory.expiresAt === null ? "Expire 90d" : "No expiry"}
                  disabled={busyId !== null}
                  onPress={() =>
                    void patch(
                      memory.id,
                      {
                        expiresAt:
                          memory.expiresAt === null ? expiryFrom(90) : null,
                      },
                      "Memory expiry updated.",
                    )
                  }
                />
                <ActionButton
                  label="Delete"
                  disabled={busyId !== null}
                  destructive
                  onPress={() => remove(memory)}
                />
              </View>
            </View>
          ))
        )}
      </View>

      {editing !== null ? (
        <View style={styles.editor}>
          <ThemedText type="smallBold">Correct memory</ThemedText>
          <TextInput
            accessibilityLabel="Correct Coach memory"
            maxLength={4_000}
            multiline
            value={editContent}
            onChangeText={setEditContent}
            style={styles.input}
          />
          <View style={styles.actions}>
            <ActionButton
              label="Save correction"
              disabled={busyId !== null || editContent.trim().length === 0}
              primary
              onPress={() =>
                void patch(
                  editing.id,
                  { content: editContent.trim() },
                  "Correction saved with its prior version in provenance.",
                )
              }
            />
            <ActionButton
              label="Cancel"
              disabled={busyId !== null}
              onPress={() => setEditing(null)}
            />
          </View>
        </View>
      ) : null}

      {message !== null ? (
        <ThemedText type="small" accessibilityRole="alert">
          {message}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

function ActionButton({
  label,
  disabled,
  primary = false,
  destructive = false,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly primary?: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        primary && styles.actionPrimary,
        destructive && styles.actionDestructive,
        disabled && styles.disabled,
      ]}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.four,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  section: { gap: Spacing.two },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  chipSelected: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  input: {
    minHeight: 76,
    color: Colors.dark.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    padding: Spacing.three,
    textAlignVertical: "top",
  },
  memory: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
  },
  memoryHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  action: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  actionPrimary: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  actionDestructive: { borderColor: "#EF4444" },
  disabled: { opacity: 0.45 },
  editor: {
    gap: Spacing.two,
    borderTopWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    paddingTop: Spacing.three,
  },
});
