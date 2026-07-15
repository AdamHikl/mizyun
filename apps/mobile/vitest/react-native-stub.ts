// Minimal stub used only by vitest. The full `react-native` package is
// not loadable outside Metro; composition-root tests need to verify
// selection logic without bringing in the native runtime.

export const Platform = {
  OS: "ios",
  select: <T>(spec: { ios?: T; android?: T; default?: T }): T | undefined =>
    spec.ios ?? spec.default,
};

export const AppState = {
  addEventListener: (): { remove: () => void } => ({ remove: () => undefined }),
};

export default { Platform, AppState };
