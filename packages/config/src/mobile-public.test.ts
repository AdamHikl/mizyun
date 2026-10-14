import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { ALLOWED_MOBILE_PUBLIC_KEYS } from "./mobile.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const bundleDirectory = (platform: string) =>
  resolve(
    REPO_ROOT,
    `apps/mobile/dist/bundle-check-${platform}/_expo/static/js/${platform}`,
  );

// Self-hosted Supabase can use the legacy public anon JWT. It is deliberately
// shipped to clients; service-role and user-session JWTs must never be bundled.
function isPublicAnonKey(token: string): boolean {
  try {
    const [header, payload, signature, extra] = token.split(".");
    if (!header || !payload || !signature) return false;
    if (
      extra !== undefined ||
      ![header, payload, signature].every(
        (part) =>
          part &&
          /^[\w-]+$/.test(part) &&
          Buffer.from(part, "base64url").toString("base64url") === part,
      ) ||
      Buffer.from(signature, "base64url").length !== 32
    )
      return false;
    const metadata = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return (
      metadata.alg === "HS256" &&
      metadata.typ === "JWT" &&
      Object.keys(metadata).every((key) => ["alg", "typ"].includes(key)) &&
      claims.iss === "supabase" &&
      claims.role === "anon" &&
      Number.isSafeInteger(claims.iat) &&
      Number.isSafeInteger(claims.exp) &&
      claims.exp > claims.iat &&
      (claims.ref === undefined || typeof claims.ref === "string") &&
      Object.keys(claims).every((key) =>
        ["iss", "ref", "role", "iat", "exp"].includes(key),
      )
    );
  } catch {
    return false;
  }
}

function forbiddenJwtCount(text: string): number {
  return (
    text.match(/e[wy][A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g) ??
    []
  ).filter((token) => {
    // Ordinary dotted property names are not encoded JOSE headers.
    try {
      const header = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64url").toString(),
      );
      return (
        header !== null &&
        typeof header === "object" &&
        ("alg" in header || "typ" in header) &&
        !isPublicAnonKey(token)
      );
    } catch {
      return false;
    }
  }).length;
}

function forbiddenSecretCount(text: string): number {
  return (text.match(/(?:sb_secret_|sbp_)[A-Za-z0-9_-]{20,}/g) ?? []).length;
}

function decodeHermesTable(output: string): string[] {
  const strings = [
    ...output.matchAll(
      /^[is]\d+\[(ASCII|UTF-16),[^\]]+\](?: #[0-9A-F]+)?: (.*)$/gm,
    ),
  ].map((match) => {
    const raw = match[2]!;
    if (match[1] === "ASCII") return raw;
    if (!/^(?:\\x[0-9A-Fa-f]{2})*$/.test(raw))
      throw new Error("Unsupported Hermes string table encoding.");
    const bytes = [...raw.matchAll(/\\x([0-9A-Fa-f]{2})/g)].map((byte) =>
      Number.parseInt(byte[1]!, 16),
    );
    if (bytes.length % 2 !== 0)
      throw new Error("Malformed Hermes UTF-16 string.");
    return Buffer.from(bytes).toString("utf16le");
  });
  const expected = Number(output.match(/String count: (\d+)/)?.[1]);
  expect(expected).toBeGreaterThan(0);
  expect(strings.length).toBe(expected);
  return strings;
}

function readHermesStrings(path: string): string[] {
  const nativePackage = require.resolve("react-native/package.json", {
    paths: [resolve(REPO_ROOT, "apps/mobile")],
  });
  const compilerPackage = require.resolve("hermes-compiler/package.json", {
    paths: [dirname(nativePackage)],
  });
  const platform =
    process.platform === "darwin"
      ? "osx-bin"
      : process.platform === "win32"
        ? "win64-bin"
        : "linux64-bin";
  const compiler = resolve(
    dirname(compilerPackage),
    "hermesc",
    platform,
    process.platform === "win32" ? "hermesc.exe" : "hermesc",
  );
  // HBC stores strings contiguously: scanning raw bytes can join a harmless
  // SDK prefix to its neighbour or extend a public JWT's signature. Decode
  // the actual string table with the installed compiler instead.
  let output: string;
  try {
    output = execFileSync(compiler, ["-b", "-dump-bytecode", path], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch {
    // The disassembly may contain credentials when this safeguard fails.
    throw new Error("Hermes bundle disassembly failed.");
  }
  return decodeHermesTable(output);
}

describe("ALLOWED_MOBILE_PUBLIC_KEYS — invariant", () => {
  it("every entry starts with the EXPO_PUBLIC_ prefix", () => {
    for (const key of ALLOWED_MOBILE_PUBLIC_KEYS) {
      expect(key.startsWith("EXPO_PUBLIC_")).toBe(true);
    }
  });

  it("contains no duplicate entries", () => {
    const unique = new Set(ALLOWED_MOBILE_PUBLIC_KEYS);
    expect(unique.size).toBe(ALLOWED_MOBILE_PUBLIC_KEYS.length);
  });

  it("does not leak any server-side secret prefix", () => {
    // Belt-and-braces: even if a future contributor types a real key name
    // here, the test should reject known secret-shaped names.
    for (const key of ALLOWED_MOBILE_PUBLIC_KEYS) {
      expect(key).not.toMatch(/SECRET/);
      expect(key).not.toMatch(/SERVICE_ROLE/);
      expect(key).not.toMatch(/^SUPABASE_SECRET/);
    }
  });
});

describe("bundle JWT credential classification", () => {
  const token = (claims: Record<string, unknown>, alg = "HS256") =>
    [
      Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify(claims)).toString("base64url"),
      Buffer.alloc(32).toString("base64url"),
    ].join(".");
  const anon = { iss: "supabase", role: "anon", iat: 1, exp: 100 };

  it("accepts only public legacy anon API keys", () => {
    expect(forbiddenJwtCount(token(anon))).toBe(0);
    expect(
      forbiddenJwtCount(token({ ...anon, ref: "synthetic-project" })),
    ).toBe(0);
  });

  it.each(["service_role", "authenticated"])("rejects %s tokens", (role) => {
    expect(forbiddenJwtCount(token({ ...anon, role }))).toBe(1);
  });

  it("rejects user claims, unexpected issuers, malformed and unsigned tokens", () => {
    for (const candidate of [
      token({ ...anon, sub: "synthetic-user" }),
      token({ ...anon, iss: "other" }),
      token({ ...anon, iat: "1" }),
      token({ ...anon, exp: 0 }),
      token(anon, "none"),
      token(anon).split(".").slice(0, 2).join("."),
      token(anon).split(".").slice(0, 2).join(".") + ".A",
      token(anon) + ".extra",
    ])
      expect(forbiddenJwtCount(candidate)).toBe(1);
  });

  it("rejects privileged JWTs with short or formatted headers", () => {
    const payload = Buffer.from(
      JSON.stringify({ ...anon, role: "service_role" }),
    ).toString("base64url");
    for (const header of ['{"alg":"HS256"}', '{\n"alg":"HS256"}'])
      expect(
        forbiddenJwtCount(
          [
            Buffer.from(header).toString("base64url"),
            payload,
            Buffer.alloc(32).toString("base64url"),
          ].join("."),
        ),
      ).toBe(1);
  });

  it("rejects secret credentials while allowing SDK prefix detection literals", () => {
    expect(forbiddenSecretCount("sb_secret_ sbp_")).toBe(0);
    expect(forbiddenSecretCount("sb_secret_" + "x".repeat(30))).toBe(1);
    expect(forbiddenSecretCount("sbp_" + "x".repeat(30))).toBe(1);
  });

  it("detects credentials in UTF-16 strings alongside non-ASCII text", () => {
    const sensitive =
      "é sb_secret_" +
      "x".repeat(30) +
      " " +
      token({ ...anon, role: "service_role" });
    const encoded = [...Buffer.from(sensitive, "utf16le")]
      .map((byte) => "\\x" + byte.toString(16).padStart(2, "0"))
      .join("");
    const strings = decodeHermesTable(
      `String count: 2\ns0[ASCII, 0..9]: sb_secret_\ns1[UTF-16, 10..20]: ${encoded}\n`,
    );
    expect(forbiddenSecretCount(strings[0]!)).toBe(0);
    expect(forbiddenSecretCount(strings[1]!)).toBe(1);
    expect(forbiddenJwtCount(strings[1]!)).toBe(1);
  });
});

// pnpm check exports each platform before testing. Cold unit-only runs may
// skip missing artifacts, but an existing empty export must fail explicitly.
for (const platform of ["ios", "android"]) {
  const directory = bundleDirectory(platform);
  describe.skipIf(!existsSync(directory))(
    `${platform} Hermes bundle purity`,
    () => {
      let strings: string[] | undefined;
      const readBundles = () => {
        if (strings) return strings;
        const paths = readdirSync(directory).filter((name) =>
          name.endsWith(".hbc"),
        );
        expect(paths.length).toBeGreaterThan(0);
        strings = paths.flatMap((path) =>
          readHermesStrings(resolve(directory, path)),
        );
        return strings;
      };

      // Disassembly is bundle preparation, bounded by the compiler's existing
      // 30-second limit; purity assertions retain the default test timeout.
      beforeAll(() => {
        readBundles();
      }, 30_000);

      it("contains no server secret literals or secret key prefixes", () => {
        for (const text of readBundles()) {
          expect(text.includes("SUPABASE_SECRET_KEY")).toBe(false);
          expect(forbiddenSecretCount(text)).toBe(0);
        }
      });

      it("contains no service-role, user-session or malformed JWT credentials", () => {
        for (const text of readBundles())
          expect(forbiddenJwtCount(text)).toBe(0);
      });
    },
  );
}
