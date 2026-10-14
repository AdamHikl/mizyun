import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
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
import {
  Button,
  Card,
  SectionHeader,
  type ButtonVariant,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";

import {
  ChoiceChip,
  ChoiceGroup,
  FormStatus,
  FormTextInput,
} from "./settings-form";

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
        status: "active",
        expiresAt: expiryFrom(newExpiryDays),
      },
      schema: coachMemoryResponseSchema,
    });
    if (result.ok) {
      setNewContent("");
      setMessage("Memory saved and confirmed. Coach will now recall it.");
      await refresh();
    } else {
      setMessage("The memory could not be saved.");
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
    <View style={styles.page}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Mizyun recalls only confirmed active memories. Deactivated items,
        low-confidence items, and expired items stay out of the Coach prompt.
      </ThemedText>

      <SectionHeader title="Add a memory" />
      <Card style={styles.section}>
        <ChoiceGroup>
          {kinds.map(([value, label]) => (
            <ChoiceChip
              key={value}
              label={label}
              selected={newKind === value}
              onPress={() => setNewKind(value)}
            />
          ))}
        </ChoiceGroup>
        <FormTextInput
          accessibilityLabel="New Coach memory"
          maxLength={4_000}
          multiline
          placeholder="Something you explicitly want Coach to remember…"
          value={newContent}
          onChangeText={setNewContent}
          style={styles.input}
        />
        <ChoiceGroup>
          {expiryChoices.map(([days, label]) => (
            <ChoiceChip
              key={label}
              label={label}
              selected={newExpiryDays === days}
              onPress={() => setNewExpiryDays(days)}
            />
          ))}
        </ChoiceGroup>
        <ActionButton
          label={busyId === "new" ? "Saving…" : "Save memory"}
          disabled={busyId !== null || newContent.trim().length === 0}
          variant="primary"
          onPress={() => void create()}
        />
      </Card>

      <SectionHeader title="Saved memories" />
      <View style={styles.section}>
        {loading ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : memories.length === 0 ? (
          <Card>
            <ThemedText type="footnote" themeColor="textSecondary">
              No Coach memories yet.
            </ThemedText>
          </Card>
        ) : (
          memories.map((memory) => (
            <Card key={memory.id} style={styles.memory}>
              <View style={styles.memoryHeading}>
                <ThemedText type="smallBold">
                  {memory.kind} · {memory.status}
                </ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  importance {memory.importance}
                </ThemedText>
              </View>
              <ThemedText type="default">{memory.preview}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
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
                  variant="destructive"
                  onPress={() => remove(memory)}
                />
              </View>
            </Card>
          ))
        )}
      </View>

      {editing !== null ? (
        <Card style={styles.section}>
          <ThemedText type="headline">Correct memory</ThemedText>
          <FormTextInput
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
              variant="tinted"
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
        </Card>
      ) : null}

      {message !== null ? (
        <FormStatus tone="neutral">{message}</FormStatus>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  disabled,
  variant = "secondary",
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly variant?: ButtonVariant;
  readonly onPress: () => void;
}) {
  return (
    <Button
      label={label}
      variant={variant}
      size="small"
      disabled={disabled}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.two },
  section: { gap: Spacing.three },
  input: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  memory: { gap: Spacing.two },
  memoryHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
