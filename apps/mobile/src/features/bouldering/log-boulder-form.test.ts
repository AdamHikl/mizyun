import { describe, expect, it } from "vitest";
import type { BoulderAscentRecord } from "@mizyun/contracts";

import {
  blankBoulderForm,
  boulderCreateBody,
  boulderFormError,
  boulderUpdateBody,
  sameAgainForm,
  selectBoulderResult,
  showsAttemptsStepper,
  stepBoulderAttempts,
  toggleUnknownAttempts,
  tryAgainForm,
  allowedBoulderResults,
} from "./log-boulder-form";
import { initialBoulderGrade } from "./presentation";

const OP = "11111111-1111-4111-8111-111111111111";

const ascent = (
  over: Partial<BoulderAscentRecord> = {},
): BoulderAscentRecord => ({
  id: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  sequence: 1,
  gradeScale: "font",
  grade: "6B",
  gradeRank: 7,
  result: "sent",
  attempts: 3,
  holdColour: "blue",
  note: null,
  photoAssetId: null,
  projectId: null,
  loggedAt: "2026-10-16T10:00:00.000Z",
  revision: 2,
  createdAt: "2026-10-16T10:00:00.000Z",
  updatedAt: "2026-10-16T10:00:00.000Z",
  ...over,
});

describe("grade preselect", () => {
  it("uses the last grade logged in this session", () => {
    expect(
      initialBoulderGrade(
        [
          { grade: "6A", sequence: 1 },
          { grade: "6C+", sequence: 3 },
          { grade: "5+", sequence: 2 },
        ],
        [{ grade: "7A", sends: 10 }],
      ),
    ).toBe("6C+");
  });

  it("falls back to the most frequently sent recent grade, harder on ties", () => {
    expect(
      initialBoulderGrade(
        [],
        [
          { grade: "6A", sends: 4 },
          { grade: "6B", sends: 4 },
          { grade: "5+", sends: 2 },
        ],
      ),
    ).toBe("6B");
  });

  it("falls back to 6A with no session or history", () => {
    expect(initialBoulderGrade([], [])).toBe("6A");
    expect(initialBoulderGrade([], [{ grade: "6C", sends: 0 }])).toBe("6A");
  });
});

describe("result and attempts rules", () => {
  const base = blankBoulderForm("6A");

  it("starts with no result selected and cannot be saved", () => {
    expect(base.result).toBeNull();
    expect(boulderFormError(base)).toBe("Choose Flash, Sent or Not yet.");
    expect(showsAttemptsStepper(base.result)).toBe(false);
  });

  it("Flash fixes one attempt and hides the stepper", () => {
    const flash = selectBoulderResult(base, "flash");
    expect(flash.attempts).toBe(1);
    expect(showsAttemptsStepper(flash.result)).toBe(false);
    const body = boulderCreateBody(flash, OP);
    expect(body).toMatchObject({ result: "flash", attempts: 1 });
  });

  it("Sent starts at 2 and stays within 2-99", () => {
    const sent = selectBoulderResult(base, "sent");
    expect(sent.attempts).toBe(2);
    expect(showsAttemptsStepper(sent.result)).toBe(true);
    expect(stepBoulderAttempts(sent, -1).attempts).toBe(2);
    expect(stepBoulderAttempts(sent, 1).attempts).toBe(3);
    let many = sent;
    for (let i = 0; i < 120; i++) many = stepBoulderAttempts(many, 1);
    expect(many.attempts).toBe(99);
  });

  it("Not yet defaults to 1 attempt and attempts are optional", () => {
    const notYet = selectBoulderResult(base, "not_yet");
    expect(notYet.attempts).toBe(1);
    expect(showsAttemptsStepper(notYet.result)).toBe(true);
    const unknown = toggleUnknownAttempts(notYet);
    expect(unknown.attempts).toBeNull();
    expect(boulderCreateBody(unknown, OP)).toMatchObject({
      result: "not_yet",
      attempts: null,
    });
    expect(stepBoulderAttempts(unknown, 1).attempts).toBe(1);
  });

  it("switching from Not yet to Sent never keeps an invalid single attempt", () => {
    const sent = selectBoulderResult(
      selectBoulderResult(base, "not_yet"),
      "sent",
    );
    expect(sent.attempts).toBe(2);
    expect(boulderFormError(sent)).toBeNull();
  });

  it("rejects an over-long note", () => {
    const form = {
      ...selectBoulderResult(base, "sent"),
      note: "x".repeat(281),
    };
    expect(boulderFormError(form)).toMatch(/280/);
    expect(boulderCreateBody(form, OP)).toBeNull();
  });

  it("builds canonical create and update payloads", () => {
    const form = {
      ...selectBoulderResult(base, "sent"),
      holdColour: "red" as const,
      note: "  crimpy  ",
    };
    expect(boulderCreateBody(form, OP)).toMatchObject({
      clientOperationId: OP,
      grade: "6A",
      result: "sent",
      attempts: 2,
      holdColour: "red",
      note: "crimpy",
      photoAssetId: null,
    });
    expect(
      boulderUpdateBody(
        form,
        ascent(),
        OP,
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toMatchObject({
      expectedRevision: 2,
      photoAssetId: "44444444-4444-4444-8444-444444444444",
    });
  });
});

describe("Same again", () => {
  it("repeats the last grade and colour and leaves the result unselected", () => {
    const form = sameAgainForm(
      ascent({ grade: "6C", holdColour: "pink" }),
      "6A",
    );
    expect(form).toEqual({
      grade: "6C",
      result: null,
      attempts: null,
      holdColour: "pink",
      note: "",
    });
    expect(boulderFormError(form)).not.toBeNull();
  });
});

describe("Try again payloads", () => {
  const PROJECT = "55555555-5555-4555-8555-555555555555";

  it("pre-fills the project's grade and colour with no result", () => {
    expect(tryAgainForm({ grade: "6C+", holdColour: "blue" }, "6A")).toEqual({
      grade: "6C+",
      result: null,
      attempts: null,
      holdColour: "blue",
      note: "",
    });
  });

  it("puts projectId on the create body and defaults it to null", () => {
    const form = selectBoulderResult(blankBoulderForm("6B"), "not_yet");
    expect(boulderCreateBody(form, OP, PROJECT)?.projectId).toBe(PROJECT);
    expect(boulderCreateBody(form, OP)?.projectId).toBeNull();
  });

  it("never links a Flash", () => {
    const flash = selectBoulderResult(blankBoulderForm("6B"), "flash");
    expect(boulderCreateBody(flash, OP, PROJECT)).toBeNull();
    expect(allowedBoulderResults(true)).toEqual(["sent", "not_yet"]);
    expect(allowedBoulderResults(false)).toEqual(["flash", "sent", "not_yet"]);
  });
});
