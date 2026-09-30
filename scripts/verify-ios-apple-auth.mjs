#!/usr/bin/env node
import { execFileSync } from "node:child_process";

// Validate the actual plist/signature, rather than source configuration intent.
try {
  const signed = process.argv[2] === "--signed";
  const path = process.argv[signed ? 3 : 2];
  if (!path) throw new Error("Missing entitlement or application path");
  if (signed) {
    // Xcode 27 signatures can contain DER only; codesign's abstract output
    // decodes that representation even when XML extraction is unavailable.
    const decoded = execFileSync(
      "codesign",
      ["-d", "--entitlements", "-", path],
      {
        encoding: "utf8",
      },
    );
    if (
      !/^\t\[Key\] com\.apple\.developer\.applesignin\r?\n\t\[Value\]\r?\n\t\t\[Array\]\r?\n\t\t\t\[String\] Default\r?$/m.test(
        decoded,
      )
    ) {
      throw new Error("Missing signed Default Apple sign-in entitlement");
    }
    process.exit(0);
  }
  const plist = execFileSync("plutil", ["-convert", "xml1", "-o", "-", path]);
  const json = execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], {
    input: plist,
    encoding: "utf8",
  });
  const capability = JSON.parse(json)["com.apple.developer.applesignin"];
  if (!Array.isArray(capability) || !capability.includes("Default")) {
    throw new Error("Missing Default Apple sign-in entitlement");
  }
} catch {
  console.error(
    "Apple sign-in entitlement verification failed; refusing reuse/install.",
  );
  process.exit(1);
}
