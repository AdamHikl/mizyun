import { expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { WeighInNotificationRouter } from "./weigh-in-notification-router";

const data = (userId: string) => ({
  url: "/log-weight",
  source: "weigh_in_reminder",
  userId,
});
const setup = () => {
  const ports = { push: vi.fn(), clear: vi.fn() };
  return { ports, router: new WeighInNotificationRouter(ports) };
};

it("opens log-weight once, for the owner, after navigation is ready", () => {
  const { ports, router } = setup();
  router.receive({ id: "n1", data: data("a") });
  router.flush("a", false);
  router.flush(null, true);
  expect(ports.push).not.toHaveBeenCalled();
  router.flush("a", true);
  router.flush("a", true);
  expect(ports.push).toHaveBeenCalledExactlyOnceWith("/log-weight");
  router.receive({ id: "n1", data: data("a") });
  router.flush("a", true);
  expect(ports.push).toHaveBeenCalledTimes(1);
});

it("ignores other notifications and another account's reminder", () => {
  const { ports, router } = setup();
  router.receive({
    id: "x",
    data: { url: "/log-meal", source: "first_meal_reminder" },
  });
  router.flush("a", true);
  router.receive({ id: "n2", data: data("b") });
  router.flush("a", true);
  expect(ports.push).not.toHaveBeenCalled();
  expect(ports.clear).toHaveBeenCalledTimes(1);
});
