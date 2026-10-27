#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  STORE_DISCLOSURES,
  declaredHealthPermissions,
  healthPermissionErrors,
  storeDeclarationErrors,
  storeDeclaredHealthPermissions,
} from "./check-android-health-permissions.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(root, "apps/mobile/package.json"));
const withHealthPermissions = require("./plugins/with-android-health-permissions.js");
const {
  allowedHealthPermissions,
} = require("./plugins/health-connect-permissions.js");

const H = "android.permission.health.";
const PRODUCTION = [`${H}READ_DISTANCE`, `${H}READ_EXERCISE`, `${H}READ_STEPS`];
const manifest = (permissions, extra = "") =>
  `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools" package="com.mizyun.app">
    <uses-permission android:name="android.permission.INTERNET" />
${permissions.map((name) => `    <uses-permission android:name="${name}" />`).join("\n")}
${extra}
</manifest>`;

const runManifestMod = async (variant) => {
  const config = withHealthPermissions(
    { name: "fixture", slug: "fixture" },
    { variant },
  );
  const mod = config.mods?.android?.manifest;
  if (!mod) return null;
  return (
    await mod({
      modResults: {
        manifest: {
          $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
          "uses-permission": [
            { $: { "android:name": `${H}READ_WEIGHT` } },
            { $: { "android:name": "android.permission.INTERNET" } },
          ],
        },
      },
      modRequest: { nextMod: async (value) => value },
    })
  ).modResults;
};

test("Production allowlist equals the Play Health Connect declaration", () => {
  const markdown = readFileSync(STORE_DISCLOSURES, "utf8");
  assert.deepEqual(storeDeclaredHealthPermissions(markdown), PRODUCTION);
  assert.deepEqual(storeDeclarationErrors(markdown), []);
  const drifted = markdown.replace(
    "(READ_STEPS, READ_EXERCISE, READ_DISTANCE)",
    "(READ_STEPS, READ_EXERCISE, READ_DISTANCE, READ_WEIGHT)",
  );
  assert.notEqual(drifted, markdown);
  assert.match(storeDeclarationErrors(drifted)[0], /READ_WEIGHT/);
});

test("Dev allowlist covers every permission the health modules declare", () => {
  const modulesDir = join(root, "apps/mobile/modules");
  const declared = new Set();
  for (const name of readdirSync(modulesDir)) {
    let xml;
    try {
      xml = readFileSync(
        join(modulesDir, name, "android/src/main/AndroidManifest.xml"),
        "utf8",
      );
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const permission of declaredHealthPermissions(xml)) {
      declared.add(permission);
    }
  }
  assert.deepEqual(
    [...declared].sort(),
    [...allowedHealthPermissions("dev")].sort(),
  );
});

test("Production plugin removes only unused Health Connect permissions", async () => {
  const result = await runManifestMod("production");
  assert.equal(
    result.manifest.$["xmlns:tools"],
    "http://schemas.android.com/tools",
  );
  const permissions = result.manifest["uses-permission"].map(({ $ }) => $);
  assert.deepEqual(
    permissions
      .filter((entry) => entry["tools:node"] === "remove")
      .map((entry) => entry["android:name"]),
    [`${H}READ_WEIGHT`, `${H}WRITE_NUTRITION`, `${H}WRITE_EXERCISE`],
  );
  assert.ok(
    permissions.some(
      (entry) =>
        entry["android:name"] === "android.permission.INTERNET" &&
        !entry["tools:node"],
    ),
  );
});

test("Dev plugin leaves the manifest unchanged", async () => {
  assert.equal(await runManifestMod("dev"), null);
  assert.throws(
    () => withHealthPermissions({}, { variant: "staging" }),
    /Unknown Health Connect permission variant/,
  );
});

test("merged manifest check enforces the exact per-variant set", () => {
  assert.deepEqual(
    healthPermissionErrors(manifest(PRODUCTION), "production"),
    [],
  );
  assert.deepEqual(
    healthPermissionErrors(
      manifest(
        PRODUCTION,
        `    <!-- <uses-permission android:name="${H}READ_WEIGHT" /> -->
    <uses-permission android:name="${H}WRITE_NUTRITION" tools:node="remove" />`,
      ),
      "production",
    ),
    [],
  );
  assert.deepEqual(
    healthPermissionErrors(
      manifest([...PRODUCTION, `${H}READ_WEIGHT`, `${H}WRITE_EXERCISE`]),
      "production",
    ),
    [
      `unused Health Connect permissions declared: ${H}READ_WEIGHT, ${H}WRITE_EXERCISE`,
    ],
  );
  assert.deepEqual(
    healthPermissionErrors(
      manifest(
        PRODUCTION.slice(1),
        `    <uses-permission-sdk-23
        android:name="${H}WRITE_NUTRITION" />`,
      ),
      "production",
    ),
    [
      `unused Health Connect permissions declared: ${H}WRITE_NUTRITION`,
      `allowlisted Health Connect permissions missing: ${H}READ_DISTANCE`,
    ],
  );
  assert.deepEqual(
    healthPermissionErrors(manifest(allowedHealthPermissions("dev")), "dev"),
    [],
  );
});
