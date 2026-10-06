import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(appRoot, "package.json"));
const expoMetro = require("expo/metro-config");
const worker = require(expoMetro.unstable_transformerPath);
const metroRequire = createRequire(require.resolve("expo/metro-config"));
const { getEnvVarDevString } = metroRequire(
  "@expo/metro-config/build/serializer/environmentVariableSerializerPlugin",
);
const metroConfig = expoMetro.getDefaultConfig(appRoot);
const shell = {
  EXPO_PUBLIC_API_URL: "https://mizyun-api-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://mizyun-supabase-dev.phiskel.com",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-reviewed-public-key",
  EXPO_PUBLIC_AUTH_REDIRECT_URI: "mizyun-dev://auth/callback",
};
const snapshotSource = `export const snapshot = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_AUTH_REDIRECT_URI: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI,
};`;
const fixtures: string[] = [];

type TransformedModule = {
  dependencies: { name: string }[];
  output: { data: { code: string } }[];
};

async function transform(
  root: string,
  filename: string,
  source: string,
  dev: boolean,
  platform: string,
): Promise<TransformedModule> {
  return worker.transform(
    metroConfig.transformer,
    root,
    filename,
    Buffer.from(source),
    {
      dev,
      minify: false,
      platform,
      type: "module",
      inlineRequires: false,
      hot: false,
      unstable_transformProfile: "default",
      customTransformOptions: {},
    },
  );
}

function execute(
  module: TransformedModule,
  dependencies: unknown[] = [],
): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const context = {
    process: { env: {} },
    __d: (factory: (...args: unknown[]) => void) =>
      factory(
        {},
        (id: number) => dependencies[id],
        undefined,
        undefined,
        { exports },
        exports,
        dependencies.map((_, index) => index),
      ),
  };
  // Use the installed Expo serializer, not a handcrafted process.env shim.
  runInNewContext(getEnvVarDevString(shell), context);
  runInNewContext(module.output[0].data.code, context);
  return exports;
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "mizyun-expo-env-"));
  fixtures.push(root);
  writeFileSync(
    join(root, ".env"),
    "EXPO_PUBLIC_API_URL=http://localhost:4000\nPRIVATE_TEST_SECRET=never-client-visible\n",
  );
  writeFileSync(
    join(root, ".env.local"),
    "EXPO_PUBLIC_API_URL=http://127.0.0.1:4000\nEXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=synthetic-conflicting-public-key\nEXPO_PUBLIC_AUTH_REDIRECT_URI=mizyun://auth/callback\n",
  );
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
  delete require.cache[require.resolve("./metro.config.js")];
});

describe("installed Expo 57 Debug environment boundary", () => {
  it("reproduces upstream dotenv overriding the reviewed shell despite EXPO_NO_DOTENV", async () => {
    vi.stubEnv("EXPO_NO_DOTENV", "1");
    const root = fixture();
    const modules = new Map<string, unknown>();
    for (const file of [".env", ".env.local"]) {
      const module = await transform(
        root,
        join(root, file),
        readFileSync(join(root, file), "utf8"),
        true,
        "ios",
      );
      modules.set(file, execute(module));
    }
    const dotenvContext = Object.assign((file: string) => modules.get(file), {
      keys: () => [...modules.keys()],
    });
    const virtualModule = await transform(
      root,
      require.resolve("expo/virtual/env"),
      "",
      true,
      "ios",
    );
    const actual = execute(virtualModule, [dotenvContext]).env as Record<
      string,
      string
    >;
    expect(actual.EXPO_PUBLIC_API_URL).toBe("http://127.0.0.1:4000");
    expect(actual.EXPO_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(actual.PRIVATE_TEST_SECRET).toBeUndefined();
  });

  it.each(["ios", "android"])(
    "keeps the reviewed shell in the actual %s Debug transform with conflicting dotenv",
    async (platform) => {
      vi.stubEnv("EXPO_NO_DOTENV", "1");
      const root = fixture();
      const config = require("./metro.config.js");
      const fallback = vi.fn(() => {
        throw new Error("Expected shell environment resolution");
      });
      const resolution = config.resolver.resolveRequest(
        { resolveRequest: fallback },
        "expo/virtual/env",
        platform,
      );
      const envModule = await transform(
        root,
        resolution.filePath,
        readFileSync(resolution.filePath, "utf8"),
        true,
        platform,
      );
      const sourceModule = await transform(
        root,
        join(root, "snapshot.js"),
        snapshotSource,
        true,
        platform,
      );
      expect(
        sourceModule.dependencies.map((dependency) => dependency.name),
      ).toContain("expo/virtual/env");
      const result = execute(sourceModule, [execute(envModule)]);
      expect(result.snapshot).toEqual(shell);
      expect(envModule.dependencies).toHaveLength(0);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it.each(["ios", "android"])(
    "preserves Release inlining on %s",
    async (platform) => {
      for (const [key, value] of Object.entries(shell)) vi.stubEnv(key, value);
      const root = fixture();
      const module = await transform(
        root,
        join(root, "snapshot.js"),
        snapshotSource,
        false,
        platform,
      );
      expect(module.dependencies).toHaveLength(0);
      expect(execute(module).snapshot).toEqual(shell);
    },
  );

  it("preserves ordinary Debug dotenv resolution and unrelated modules", () => {
    vi.stubEnv("EXPO_NO_DOTENV", "0");
    const config = require("./metro.config.js");
    const normal = { type: "sourceFile", filePath: "normal-resolution.js" };
    const fallback = vi.fn(() => normal);
    expect(
      config.resolver.resolveRequest(
        { resolveRequest: fallback },
        "expo/virtual/env",
        "ios",
      ),
    ).toBe(normal);
    vi.stubEnv("EXPO_NO_DOTENV", "1");
    expect(
      config.resolver.resolveRequest(
        { resolveRequest: fallback },
        "expo-router",
        "android",
      ),
    ).toBe(normal);
    expect(fallback).toHaveBeenCalledTimes(2);
  });
});
