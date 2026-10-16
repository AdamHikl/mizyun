import type {
  BoulderProgressResponse,
  BoulderProjectRecord,
} from "@mizyun/contracts";

/** Test fixtures shared by the BLD-04 progress/projects tests. */
export const projectFixture = (
  over: Partial<BoulderProjectRecord> = {},
): BoulderProjectRecord => ({
  id: "66666666-6666-4666-8666-666666666666",
  grade: "6B",
  gradeRank: 7,
  holdColour: "red",
  status: "open",
  firstLoggedAt: "2026-09-01T10:00:00.000Z",
  sentAt: null,
  sentAscentId: null,
  attempts: 5,
  attemptsComplete: true,
  sessions: 2,
  sentAfterSessions: null,
  lastTriedAt: "2026-10-10T10:00:00.000Z",
  older: false,
  ...over,
});

export const progressFixture = (
  over: Partial<BoulderProgressResponse> = {},
): BoulderProgressResponse => ({
  window: "90d",
  pyramid: [
    { grade: "6A", gradeRank: 5, sends: 10, flashes: 4 },
    { grade: "6B", gradeRank: 7, sends: 7, flashes: 3 },
    { grade: "6C+", gradeRank: 10, sends: 1, flashes: 0 },
  ],
  timeline: [
    {
      sessionId: "77777777-7777-4777-8777-000000000001",
      activityDate: "2026-09-20",
      topGrade: "6A",
      personalBest: false,
    },
    {
      sessionId: "77777777-7777-4777-8777-000000000002",
      activityDate: "2026-09-27",
      topGrade: null,
      personalBest: false,
    },
    {
      sessionId: "77777777-7777-4777-8777-000000000003",
      activityDate: "2026-10-04",
      topGrade: "6C+",
      personalBest: true,
    },
  ],
  totals: { sessions: 3, sends: 18, flashes: 7 },
  ...over,
});
