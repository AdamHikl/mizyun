// Expo's Debug serializer supplies only EXPO_PUBLIC_* shell values here.
// Keep the whole-object read: static properties would import expo/virtual/env.
export const env = process.env;
