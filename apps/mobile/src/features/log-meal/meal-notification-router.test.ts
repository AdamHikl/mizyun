import { expect, it, vi } from "vitest";
import { MealNotificationRouter } from "./meal-notification-router";
function setup() {
  const ports = { push: vi.fn(), clear: vi.fn() };
  return { ports, bridge: new MealNotificationRouter(ports) };
}
const notification = {
  id: "one",
  data: { url: "/log-meal", source: "first_meal_reminder", userId: "a" },
};
it("retains a cold-start tap until both authentication and root navigation are ready", () => {
  const { ports, bridge } = setup();
  bridge.receive(notification);
  bridge.flush(null, true);
  bridge.flush("a", false);
  expect(ports.push).not.toHaveBeenCalled();
  expect(ports.clear).not.toHaveBeenCalled();
  bridge.flush("a", true);
  expect(ports.push).toHaveBeenCalledWith({
    pathname: "/log-meal",
    params: { source: "first_meal_reminder" },
  });
  expect(ports.clear).toHaveBeenCalledTimes(1);
});
it("routes only once when the initial response and live listener deliver the same tap", () => {
  const { ports, bridge } = setup();
  bridge.receive(notification);
  bridge.flush("a", true);
  bridge.receive(notification);
  bridge.flush("a", true);
  expect(ports.push).toHaveBeenCalledTimes(1);
});
it.each(["b", undefined])(
  "rejects another owner's or legacy unscoped reminder (%s)",
  (owner) => {
    const { ports, bridge } = setup();
    bridge.receive({
      ...notification,
      data: { ...notification.data, userId: owner },
    });
    bridge.flush("a", true);
    expect(ports.push).not.toHaveBeenCalled();
    expect(ports.clear).toHaveBeenCalledTimes(1);
  },
);
it("keeps the existing evening meal-history destination", () => {
  const { ports, bridge } = setup();
  bridge.receive({
    id: "evening",
    data: { url: "/meals", source: "evening_catch_up" },
  });
  bridge.flush("a", true);
  expect(ports.push).toHaveBeenCalledWith({
    pathname: "/meals",
    params: { source: "evening_catch_up" },
  });
});
it("does not consume Coach or arbitrary external URLs", () => {
  const { ports, bridge } = setup();
  bridge.receive({ id: "other", data: { url: "https://example.com" } });
  bridge.flush("a", true);
  expect(ports.push).not.toHaveBeenCalled();
  expect(ports.clear).not.toHaveBeenCalled();
});
