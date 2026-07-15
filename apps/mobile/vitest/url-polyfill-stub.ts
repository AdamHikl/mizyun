// The real `react-native-url-polyfill/auto` mutates global `URL` and
// `URLSearchParams` on import. Under Node (vitest's environment), `URL`
// already exists, so this stub is a no-op side-effect import.

export {};
