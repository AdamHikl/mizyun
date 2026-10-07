import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface AppleRevocationTokenBinding {
  readonly jobId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly subject: string;
}

const VAULT_ERROR = "Apple revocation token protection failed";
const MAX_TOKEN_BYTES = 16384;

function keyBytes(key: string): Buffer {
  if (typeof key !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(key))
    throw new Error(VAULT_ERROR);
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== key)
    throw new Error(VAULT_ERROR);
  return bytes;
}

function associatedData(binding: AppleRevocationTokenBinding): Buffer {
  const values = [
    binding.jobId,
    binding.userId,
    binding.clientId,
    binding.subject,
  ];
  if (
    values.some(
      (value) =>
        typeof value !== "string" || !value.trim() || value.length > 1024,
    )
  )
    throw new Error(VAULT_ERROR);
  return Buffer.from(JSON.stringify(["apple-revocation-v1", ...values]));
}

function decode(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error(VAULT_ERROR);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error(VAULT_ERROR);
  return bytes;
}

export function encryptAppleRevocationToken(
  token: string,
  key: string,
  binding: AppleRevocationTokenBinding,
): string {
  try {
    if (
      typeof token !== "string" ||
      !token.trim() ||
      Buffer.byteLength(token) > MAX_TOKEN_BYTES
    )
      throw new Error(VAULT_ERROR);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
    cipher.setAAD(associatedData(binding));
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      version: 1,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    });
  } catch {
    throw new Error(VAULT_ERROR);
  }
}

export function decryptAppleRevocationToken(
  envelope: string,
  key: string,
  binding: AppleRevocationTokenBinding,
): string {
  try {
    if (typeof envelope !== "string" || envelope.length > 24000)
      throw new Error(VAULT_ERROR);
    const parsed: unknown = JSON.parse(envelope);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(VAULT_ERROR);
    const record = parsed as Record<string, unknown>;
    if (
      record["version"] !== 1 ||
      Object.keys(record).sort().join(",") !== "ciphertext,nonce,tag,version"
    )
      throw new Error(VAULT_ERROR);
    const nonce = decode(record["nonce"]);
    const tag = decode(record["tag"]);
    const ciphertext = decode(record["ciphertext"]);
    if (
      nonce.length !== 12 ||
      tag.length !== 16 ||
      ciphertext.length > MAX_TOKEN_BYTES
    )
      throw new Error(VAULT_ERROR);
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), nonce);
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!token.trim()) throw new Error(VAULT_ERROR);
    return token;
  } catch {
    throw new Error(VAULT_ERROR);
  }
}
