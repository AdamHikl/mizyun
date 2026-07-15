// Minimal stub used only by vitest. The real `expo-secure-store` requires
// the Expo runtime; composition-root tests need a no-op implementation
// so the auth-client module is loadable under `vitest`.

const noopAsync = async (): Promise<null> => null;

export const getItemAsync = noopAsync;
export const setItemAsync = noopAsync;
export const deleteItemAsync = noopAsync;

export default {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
};
