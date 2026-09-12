// Minimal stub used only by vitest. The real `expo-constants` requires
// the Expo runtime; tests need a configurable object.

export interface ExpoConstantsStub {
  expoConfig: {
    extra?: Record<string, unknown>;
    scheme?: string;
  } | null;
}

const Constants: ExpoConstantsStub = {
  expoConfig: null,
};

export default Constants;
