/**
 * AI-MOB-002 — Render CoachMessage.evidenceKinds as tappable
 * Collapsible chips. Each chip expands to a deterministic human
 * summary keyed on the kind string. No schema change, no extra
 * API call.
 *
 * `memory` is rendered as "Context recalled" — the chip is
 * labelled as untrusted-data, not as a confirmed fact, because
 * the route filters `kind: "memory"` out of `evidenceKinds` per
 * MEM-001. If a memory-evidence row does slip through, the label
 * still reads as "context" rather than "confirmed".
 */

import { useState } from "react";
import { Pressable, View } from "react-native";

import { Collapsible } from "@/components/ui/collapsible";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

const SUMMARY_BY_KIND: Readonly<Record<string, string>> = {
  profile: "Your confirmed profile (units, timezone, height, activity).",
  goal: "Your active Mizyun goal (kind, pace, target, target date).",
  nutrition: "Your confirmed nutrition log within the last 28 days.",
  training: "Your confirmed training within the last 28 days.",
  body: "Your confirmed weight trend and recent measurements.",
  energy: "Deterministic energy calculation (Mifflin-St Jeor).",
  plan: "Deterministic calorie, protein, and training plan.",
  memory: "Context recalled from your memory store (untrusted data).",
  tool: "Live tool result from the Coach runtime (read-only).",
};

const labelFor = (kind: string): string => {
  const summary = SUMMARY_BY_KIND[kind];
  if (summary !== undefined) return summary;
  return `Coach tool: ${kind}`;
};

export interface EvidenceChipsProps {
  readonly kinds: readonly string[];
}

export function EvidenceChips({ kinds }: EvidenceChipsProps) {
  const [open, setOpen] = useState<string | null>(null);
  if (kinds.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.one }}
      accessibilityRole="list"
    >
      {kinds.map((kind) => {
        const isOpen = open === kind;
        const summary = labelFor(kind);
        return (
          <View
            key={kind}
            style={{
              backgroundColor: Colors.dark.backgroundElement,
              borderRadius: Spacing.two,
              paddingHorizontal: Spacing.two,
              paddingVertical: Spacing.one,
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show details for ${kind}`}
              accessibilityHint={summary}
              accessibilityState={{ expanded: isOpen }}
              onPress={() => setOpen(isOpen ? null : kind)}
              hitSlop={8}
            >
              <ThemedText type="smallBold">{kind}</ThemedText>
            </Pressable>
            <Collapsible
              open={isOpen}
              onOpenChange={(value) => setOpen(value ? kind : null)}
            >
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ marginTop: Spacing.one }}
              >
                {summary}
              </ThemedText>
            </Collapsible>
          </View>
        );
      })}
    </View>
  );
}
