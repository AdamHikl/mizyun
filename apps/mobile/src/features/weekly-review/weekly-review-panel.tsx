import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, ListGroup, ListRow, Notice } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { WeeklyReviewState } from "./weekly-review-controller";
import {
  formatKcal,
  formatSignedKcal,
  observedVsBand,
  REVIEW_METHOD_TEXT,
  reasonText,
  reviewHeadline,
  visibleTargetChange,
} from "./weekly-review-copy";
import type { WeeklyReviewSnapshot } from "./weekly-review-data";
import type { WeightUnitSystem } from "@/lib/weight-units";

export interface WeeklyReviewPanelProps {
  readonly snapshot: WeeklyReviewSnapshot;
  readonly unitSystem: WeightUnitSystem;
  readonly submitting: WeeklyReviewState["submitting"];
  readonly message: string | null;
  readonly outcome: WeeklyReviewState["outcome"];
  /** Live daily target; accepting applies the change on top of this. */
  readonly liveTargetKcal?: number | null;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  /** Optional dismissal that keeps the proposal pending (pop-up only). */
  readonly onLater?: () => void;
}

/** Review details and decision buttons, shared by the screen and the pop-up. */
export function WeeklyReviewPanel(props: WeeklyReviewPanelProps) {
  const { snapshot, unitSystem, submitting, message, outcome } = props;
  const proposal = snapshot.proposal;
  // A stored proposal carries the review it was made from.
  const review = proposal?.review ?? snapshot.review;
  const targetChange = review === null ? 0 : visibleTargetChange(review);

  if (review === null) {
    return (
      <Notice
        tone="info"
        title="No weekly check-in"
        message="Set a goal and confirm your energy inputs to get a weekly calorie check-in."
      />
    );
  }

  const pending = proposal?.status === "pending";
  const decided =
    proposal !== null &&
    (proposal.status === "accepted" ||
      proposal.status === "declined" ||
      proposal.status === "superseded");
  const observed = observedVsBand(review, unitSystem);
  const busy = submitting !== null;

  return (
    <View style={styles.root}>
      <ThemedText type="title3" accessibilityRole="header">
        {reviewHeadline(review)}
      </ThemedText>
      <ThemedText type="footnote" themeColor="textSecondary">
        {review.goalMode.label}
      </ThemedText>

      {review.status === "adjust" &&
      review.currentTargetKcal !== null &&
      review.proposedTargetKcal !== null ? (
        <Card>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Proposed change
          </ThemedText>
          <ThemedText type="title3">
            {formatSignedKcal(targetChange)}/day
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {props.liveTargetKcal != null
              ? `Your target would be about ${formatKcal(props.liveTargetKcal + targetChange)} (now ${formatKcal(props.liveTargetKcal)}).`
              : `At the time of the review: ${formatKcal(review.currentTargetKcal)} \u2192 ${formatKcal(review.proposedTargetKcal)}.`}
          </ThemedText>
        </Card>
      ) : review.currentTargetKcal !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Target at the time of the review:{" "}
          {formatKcal(review.currentTargetKcal)} per day
        </ThemedText>
      ) : null}

      <ListGroup>
        {observed ? (
          <ListRow
            title="Observed weekly change"
            subtitle={observed.band}
            value={observed.value}
            chevron={false}
          />
        ) : (
          <ListRow
            title="Observed weekly change"
            value="Not enough weigh-ins"
            chevron={false}
          />
        )}
        <ListRow
          title="Logged days"
          value={`${review.loggedDays} of 7`}
          chevron={false}
        />
        <ListRow
          title="Average intake"
          subtitle={
            review.currentTargetKcal !== null
              ? `Target ${formatKcal(review.currentTargetKcal)}`
              : undefined
          }
          value={
            review.averageIntakeKcal !== null
              ? `${formatKcal(review.averageIntakeKcal)}${review.adherencePercent !== null ? ` (${review.adherencePercent}%)` : ""}`
              : "—"
          }
          chevron={false}
        />
      </ListGroup>

      {review.method !== null ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {REVIEW_METHOD_TEXT[review.method]}
        </ThemedText>
      ) : null}

      <View style={styles.reasons}>
        {review.reasons.map((reason) => (
          <ThemedText key={reason} type="small">
            {reasonText(reason)}
          </ThemedText>
        ))}
      </View>

      <ThemedText type="footnote" themeColor="textSecondary">
        Advisory estimate based on your logs and weigh-ins. You decide whether
        to change your target.
      </ThemedText>

      {message !== null ? <Notice tone="warning" message={message} /> : null}

      {outcome === "accept" ? (
        <Notice
          tone="success"
          title="Target updated"
          message="Your new calorie target is in effect."
        />
      ) : outcome === "decline" ? (
        <Notice
          tone="info"
          title="Target kept"
          message="Your calorie target stays as it is."
        />
      ) : decided && proposal?.status === "accepted" ? (
        <Notice tone="success" message="You accepted this adjustment." />
      ) : decided && proposal?.status === "declined" ? (
        <Notice tone="info" message="You kept your current target." />
      ) : decided && proposal?.status === "superseded" ? (
        <Notice
          tone="info"
          message="This proposal was replaced by a newer one."
        />
      ) : null}

      {pending ? (
        <View style={styles.actions}>
          <Button
            label="Accept new target"
            accessibilityLabel="Accept new calorie target"
            block
            loading={submitting === "accept"}
            disabled={busy}
            onPress={props.onAccept}
          />
          <Button
            label="Keep current target"
            accessibilityLabel="Decline the proposed calorie target"
            variant="secondary"
            block
            loading={submitting === "decline"}
            disabled={busy}
            onPress={props.onDecline}
          />
          {props.onLater ? (
            <Button
              label="Later"
              variant="plain"
              block
              disabled={busy}
              onPress={props.onLater}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  reasons: { gap: Spacing.one },
  actions: { gap: Spacing.two },
});
