import { describe, it, expect } from "vitest";
import { communityExpansionOperationGate } from "./operations";
describe("expansion emergency stops", () => {
  it("keeps messages opt-out/delete available while writes stop", () => {
    expect(
      communityExpansionOperationGate("POST", "/v1/community/messaging", {
        operation: "preferences",
        enabled: false,
      }),
    ).toBeNull();
    expect(
      communityExpansionOperationGate("POST", "/v1/community/messaging", {
        operation: "delete",
      }),
    ).toBeNull();
    expect(
      communityExpansionOperationGate("POST", "/v1/community/messaging", {
        operation: "send",
      }),
    ).toBe("engagement");
  });
  it("classifies reads, deliberate audience choices and challenge reductions", () => {
    expect(
      communityExpansionOperationGate(
        "POST",
        "/v1/community/broader-discovery",
        { operation: "search" },
      ),
    ).toBe("browsing");
    expect(
      communityExpansionOperationGate(
        "POST",
        "/v1/community/broader-discovery",
        { operation: "preferences", enabled: true },
      ),
    ).toBe("engagement");
    expect(
      communityExpansionOperationGate("POST", "/v1/community/challenges", {
        operation: "removeContribution",
      }),
    ).toBeNull();
    expect(
      communityExpansionOperationGate("POST", "/v1/community/challenges", {
        operation: "contribute",
      }),
    ).toBe("engagement");
  });
  it("preserves comment safety reports and unshare operations", () => {
    expect(
      communityExpansionOperationGate(
        "POST",
        "/v1/community/comments/abc/report",
        {},
      ),
    ).toBeNull();
    expect(
      communityExpansionOperationGate(
        "DELETE",
        "/v1/community/routines/abc",
        {},
      ),
    ).toBeNull();
    expect(
      communityExpansionOperationGate(
        "PUT",
        "/v1/community/activities/abc/comments/settings",
        { enabled: false },
      ),
    ).toBeNull();
  });
});

it("keeps owner management and independent safety review accessible during growth stops", () => {
  for (const url of [
    "/v1/community/routines?mine=true",
    "/v1/community/media?mine=true",
    "/v1/community/media/moderation",
  ])
    expect(communityExpansionOperationGate("GET", url, {})).toBeNull();
  expect(
    communityExpansionOperationGate(
      "POST",
      "/v1/community/media/reports/abc/content",
      {},
    ),
  ).toBeNull();
  expect(
    communityExpansionOperationGate(
      "GET",
      "/v1/community/routines?mine=false",
      {},
    ),
  ).toBe("browsing");
  expect(
    communityExpansionOperationGate("POST", "/v1/community/challenges", {
      operation: "listMine",
    }),
  ).toBeNull();
});

it("allows own group discovery and challenge controls while browsing stops", () => {
  expect(
    communityExpansionOperationGate("POST", "/v1/community/groups/operations", {
      operation: "list",
    }),
  ).toBeNull();
  expect(
    communityExpansionOperationGate("POST", "/v1/community/challenges", {
      operation: "getMine",
    }),
  ).toBeNull();
  expect(
    communityExpansionOperationGate("POST", "/v1/community/challenges", {
      operation: "get",
    }),
  ).toBe("browsing");
});
