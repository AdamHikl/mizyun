import { describe, expect, it, vi } from "vitest";
import { createGroupMutationIntentStore } from "./mutation-intent";
describe("ambiguous group mutation responses", () => {
  it("retries the same publication without creating another operation", () => {
    const newId = vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two");
    const store = createGroupMutationIntentStore(newId);
    expect(
      store.operationId("post", {
        groupId: "a",
        membershipVersion: 1,
        body: "Hello",
      }),
    ).toBe("one");
    expect(
      store.operationId("post", {
        groupId: "a",
        membershipVersion: 1,
        body: "Hello",
      }),
    ).toBe("one");
    expect(newId).toHaveBeenCalledTimes(1);
    expect(
      store.operationId("post", {
        groupId: "a",
        membershipVersion: 2,
        body: "Hello",
      }),
    ).toBe("two");
  });
  it("changed audience/text is a new explicit publication; completed/cleared intents cannot replay", () => {
    let i = 0;
    const store = createGroupMutationIntentStore(() => String(++i));
    expect(store.operationId("post", { groupId: "a", body: "A" })).toBe("1");
    expect(store.operationId("post", { groupId: "b", body: "A" })).toBe("2");
    expect(store.operationId("post", { groupId: "b", body: "B" })).toBe("3");
    store.complete("post");
    expect(store.operationId("post", { groupId: "b", body: "B" })).toBe("4");
    expect(store.operationId("create", { name: "Friends" })).toBe("5");
    store.clear();
    expect(store.operationId("create", { name: "Friends" })).toBe("6");
  });
});
