import type {
  CalorieAdjustmentProposal,
  CalorieReviewWire,
} from "@mizyun/contracts";

export const reviewFixture = (
  overrides: Partial<CalorieReviewWire> = {},
): CalorieReviewWire => ({
  version: "v1-2026-10",
  computedAt: "2026-10-12T09:00:00.000Z",
  status: "adjust",
  reasons: ["below_band"],
  method: "rate_error",
  goalMode: {
    id: "standard_cut",
    label: "Standard cut",
    minWeeklyPercent: -0.75,
    maxWeeklyPercent: -0.5,
    targetWeeklyPercent: -0.625,
  },
  goalAgeDays: 28,
  observedWeeklyPercent: -0.2,
  observedWeeklyChangeKg: -0.16,
  smoothedWeightKg: 80,
  loggedDays: 6,
  averageIntakeKcal: 2300,
  adherencePercent: 98,
  adaptiveMaintenanceKcal: null,
  currentTargetKcal: 2350,
  proposedTargetKcal: 2200,
  deltaKcal: -150,
  calibrationBeforeKcal: 0,
  calibrationAfterKcal: -150,
  ...overrides,
});

export const PROPOSAL_ID = "00000000-0000-4000-8000-0000000000a1";

export const proposalFixture = (
  overrides: Partial<CalorieAdjustmentProposal> = {},
): CalorieAdjustmentProposal => ({
  id: PROPOSAL_ID,
  goalId: "00000000-0000-4000-8000-0000000000b1",
  weekStart: "2026-10-12",
  status: "pending",
  review: reviewFixture(),
  createdAt: "2026-10-12T09:00:00.000Z",
  decidedAt: null,
  ...overrides,
});
