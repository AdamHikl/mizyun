import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  acquisitionSourceSchema,
  profileResponseSchema,
  type AcquisitionSource,
  type FirstLogChoice,
  type UnitSystem,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceGroup,
  ListGroup,
  ListRow,
  type IconName,
} from "@/components/ui";
import { activationMilestones } from "@/composition/analytics-client";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import { AnalyticsConsentPrompt } from "@/features/analytics/analytics-consent-prompt";

/** First-run options in display order; climbing leads for the beachhead. */
export const firstLogOptions = (
  boulderingEnabled: boolean,
): ReadonlyArray<{
  readonly choice: FirstLogChoice;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: IconName;
}> => [
  ...(boulderingEnabled
    ? [
        {
          choice: "climb" as const,
          title: "A climbing session",
          subtitle: "Starts a bouldering session now",
          icon: "mobility" as const,
        },
      ]
    : []),
  {
    choice: "workout",
    title: "A workout",
    subtitle: "Starts a one-time training session",
    icon: "dumbbell",
  },
  {
    choice: "meal",
    title: "A meal",
    subtitle: "A name is enough; add details later",
    icon: "fork",
  },
  {
    choice: "weight",
    title: "My weight",
    subtitle: "Today's scale reading",
    icon: "scale",
  },
];

export const acquisitionSourceLabels: Record<AcquisitionSource, string> = {
  friend_or_family: "Friend or family",
  climbing_gym_or_club: "Climbing gym or club",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  reddit: "Reddit",
  app_store_search: "App Store or Google Play",
  web_search: "Web search",
  press_or_blog: "Article or blog",
  other: "Somewhere else",
  prefer_not_to_say: "Prefer not to say",
};

interface FirstRunCardProps {
  readonly owner: string;
  readonly unitSystem: UnitSystem;
  readonly boulderingEnabled: boolean;
  /** Opens the fastest capture for the choice. */
  readonly onChoose: (choice: FirstLogChoice) => void;
  readonly onUnitsSaved: () => void;
  readonly onDone: () => void;
}

/**
 * GTM-04 first run: one tap from Home to a capture screen. Profile, goal and
 * energy inputs stay in the deferred "Set up Mizyun" wizard; AI consent and
 * its adult confirmation stay at the first Coach send.
 */
export function FirstRunCard({
  owner,
  unitSystem,
  boulderingEnabled,
  onChoose,
  onUnitsSaved,
  onDone,
}: FirstRunCardProps) {
  const shownAt = useRef(Date.now());
  const [consent, setConsent] = useState<"unknown" | "granted" | "denied">(
    "unknown",
  );
  const [source, setSource] = useState<AcquisitionSource | null>(null);
  const [units, setUnits] = useState<UnitSystem>(unitSystem);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => setUnits(unitSystem), [unitSystem]);

  const finish = useCallback(
    async (choice: FirstLogChoice | "explore") => {
      if (choosing) return;
      setChoosing(true);
      try {
        await activationMilestones.completeFirstRun(
          owner,
          choice,
          shownAt.current,
        );
      } catch {
        /* The first run never blocks logging. */
      }
      onDone();
      if (choice !== "explore") onChoose(choice);
    },
    [choosing, onChoose, onDone, owner],
  );

  const chooseUnits = useCallback(
    async (next: UnitSystem) => {
      if (next === units) return;
      const previous = units;
      setUnits(next);
      setUnitsError(null);
      const result = await apiClient.request({
        method: "PUT",
        path: "/v1/profile",
        body: { unitSystem: next },
        schema: profileResponseSchema,
      });
      if (result.ok) {
        onUnitsSaved();
      } else {
        setUnits(previous);
        setUnitsError("Units were not saved. Try again or change them later.");
      }
    },
    [onUnitsSaved, units],
  );

  const chooseAndReport = useCallback(
    async (choice: FirstLogChoice | "explore") => {
      await finish(choice);
      if (source !== null && consent === "granted") {
        try {
          await activationMilestones.recordAcquisitionSource(owner, source);
        } catch {
          /* Optional analytics cannot block navigation. */
        }
      }
    },
    [consent, finish, owner, source],
  );

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="headline">What do you want to log first?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pick one to start. Your name, goal and energy details can wait until
          you set up Mizyun.
        </ThemedText>
      </View>
      <ListGroup>
        {firstLogOptions(boulderingEnabled).map((option) => (
          <ListRow
            key={option.choice}
            icon={option.icon}
            title={option.title}
            subtitle={option.subtitle}
            accessibilityLabel={`Log ${option.title.toLowerCase()} first`}
            disabled={choosing}
            onPress={() => void chooseAndReport(option.choice)}
          />
        ))}
      </ListGroup>

      <View style={styles.section}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Units
        </ThemedText>
        <ChoiceGroup>
          <ChoiceChip
            label="Metric (kg, cm)"
            selected={units === "metric"}
            onPress={() => void chooseUnits("metric")}
          />
          <ChoiceChip
            label="Imperial (lb, in)"
            selected={units === "imperial"}
            onPress={() => void chooseUnits("imperial")}
          />
        </ChoiceGroup>
        {unitsError ? (
          <ThemedText
            accessibilityRole="alert"
            type="footnote"
            themeColor="danger"
          >
            {unitsError}
          </ThemedText>
        ) : null}
      </View>

      <AnalyticsConsentPrompt onConsentChange={setConsent} />

      {consent === "granted" ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">
            How did you hear about Mizyun?
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Optional. Only the option you pick is sent, when you choose what to
            log first.
          </ThemedText>
          <ChoiceGroup>
            {acquisitionSourceSchema.options.map((option) => (
              <ChoiceChip
                key={option}
                label={acquisitionSourceLabels[option]}
                selected={source === option}
                onPress={() => setSource(option)}
              />
            ))}
          </ChoiceGroup>
        </View>
      ) : null}

      <Button
        label="Just look around"
        variant="secondary"
        disabled={choosing}
        onPress={() => void chooseAndReport("explore")}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three },
  header: { gap: Spacing.one },
  section: { gap: Spacing.two },
});
