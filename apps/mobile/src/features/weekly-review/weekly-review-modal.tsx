import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { Radius, Spacing } from "@/constants/theme";
import { useAuth } from "@/features/auth/auth-context";
import { refreshEnergyAfterDecision } from "./refresh-energy";
import { useWeeklyReview } from "./use-weekly-review";
import { resolvePopupToOpen } from "./weekly-review-seen";
import { WeeklyReviewPanel } from "./weekly-review-panel";
import { isPendingProposal } from "./weekly-review-data";

/**
 * Home pop-up. Loads the weekly review in the background (and again on every
 * focus via expo-router focus), and opens once per pending proposal id: the id is
 * recorded as seen before it is shown, so "Later" does not nag again, in this
 * session or after a restart. Accept/Decline close it through the outcome.
 */
export function WeeklyReviewPopup() {
  const theme = useTheme();
  const { profile } = useAuth();
  const { controller, state } = useWeeklyReview({
    onDecided: refreshEnergyAfterDecision,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const checking = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The hook loads once on mount; refetch on every later Home focus.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void controller?.load();
    }, [controller]),
  );

  const proposal = state.snapshot?.proposal ?? null;
  const userId = controller === null ? null : controller.userId;

  useEffect(() => {
    setOpenId(null);
    checking.current = null;
  }, [userId]);

  const currentUser = useRef<string | null>(userId);
  currentUser.current = userId;
  useEffect(() => {
    if (userId === null || !isPendingProposal(proposal)) return;
    if (openId === proposal.id || checking.current === proposal.id) return;
    const id = proposal.id;
    checking.current = id;
    void resolvePopupToOpen(
      userId,
      proposal,
      () => mounted.current && currentUser.current === userId,
    ).then((open) => {
      if (checking.current === id) checking.current = null;
      if (open !== null) setOpenId(open);
    });
  }, [userId, proposal, openId]);

  const close = useCallback(() => setOpenId(null), []);

  // A decided proposal closes the sheet after the outcome has been visible.
  useEffect(() => {
    if (openId === null || state.outcome === null) return;
    const timer = setTimeout(close, 1_800);
    return () => clearTimeout(timer);
  }, [openId, state.outcome, close]);

  if (controller === null || openId === null || state.snapshot === null) {
    return null;
  }
  return (
    <Modal animationType="slide" transparent visible onRequestClose={close}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View
          style={[styles.sheet, { backgroundColor: theme.background }]}
          accessibilityViewIsModal
        >
          <ScrollView contentContainerStyle={styles.content}>
            <WeeklyReviewPanel
              snapshot={state.snapshot}
              unitSystem={profile?.unitSystem ?? "metric"}
              submitting={state.submitting}
              message={state.message}
              outcome={state.outcome}
              liveTargetKcal={state.liveTargetKcal}
              onAccept={() => void controller.decide("accept")}
              onDecline={() => void controller.decide("decline")}
              onLater={close}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
  },
  content: { padding: Spacing.three, paddingBottom: Spacing.five },
});
