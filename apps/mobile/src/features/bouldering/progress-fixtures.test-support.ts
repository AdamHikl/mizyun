import type {
  BoulderAscentRecord,
  BoulderGradeSendsResponse,
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

const SESSION_A = "77777777-7777-4777-8777-00000000000a";
const SESSION_B = "77777777-7777-4777-8777-00000000000b";

export const gradeAscentFixture = (
  over: Partial<BoulderAscentRecord> = {},
): BoulderAscentRecord => ({
  id: "99999999-9999-4999-8999-000000000001",
  sessionId: SESSION_A,
  sequence: 1,
  gradeScale: "font",
  grade: "6A",
  gradeRank: 5,
  result: "sent",
  attempts: 3,
  holdColour: "blue",
  note: null,
  photoAssetId: null,
  projectId: null,
  loggedAt: "2026-10-22T18:00:00.000Z",
  revision: 1,
  createdAt: "2026-10-22T18:00:00.000Z",
  updatedAt: "2026-10-22T18:00:00.000Z",
  ...over,
});

/** 6A in the last 90 days: two sends today at North Wall, one older flash. */
export const gradeSendsFixture = (
  over: Partial<BoulderGradeSendsResponse> = {},
): BoulderGradeSendsResponse => ({
  window: "90d",
  grade: "6A",
  sends: [
    {
      activityDate: "2026-10-22",
      gymName: "North Wall",
      ascent: gradeAscentFixture({
        photoAssetId: "55555555-5555-4555-8555-555555555555",
        note: "Slab finish",
      }),
    },
    {
      activityDate: "2026-10-22",
      gymName: "North Wall",
      ascent: gradeAscentFixture({
        id: "99999999-9999-4999-8999-000000000002",
        sequence: 4,
        result: "sent",
        attempts: null,
        holdColour: null,
      }),
    },
    {
      activityDate: "2026-10-08",
      gymName: null,
      ascent: gradeAscentFixture({
        id: "99999999-9999-4999-8999-000000000003",
        sessionId: SESSION_B,
        result: "flash",
        attempts: 1,
        holdColour: "yellow",
      }),
    },
  ],
  ...over,
});
