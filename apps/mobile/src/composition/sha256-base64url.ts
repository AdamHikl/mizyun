import * as Crypto from "expo-crypto";

/**
 * Unpadded base64url SHA-256 of the string's UTF-8 bytes (expo-crypto hashes
 * `str.data(using: .utf8)` on iOS), the encoding the API uses in its `ETag`.
 */
export const sha256Base64Url = async (text: string): Promise<string> =>
  toBase64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );

export const toBase64Url = (base64: string): string =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
