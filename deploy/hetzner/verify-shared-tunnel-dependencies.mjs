#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const tunnelProperties = [
  "Id",
  "LoadState",
  "UnitFileState",
  "After",
  "Before",
  "Wants",
  "Requires",
  "Requisite",
  "BindsTo",
  "PartOf",
  "Conflicts",
  "ConflictedBy",
  "PropagatesStopTo",
  "StopPropagatedFrom",
  "Type",
  "Restart",
];

const origins = ["mizyun-api.service", "mizyun-api-dev.service"];
const startupUnits = ["network-online.target", ...origins];

// Read systemctl's resolved properties, including dependencies introduced by
// drop-ins and .requires/ symlinks. This does not assert live routing health.
export function verifyTunnelDependencies(snapshot) {
  const properties = new Map();
  const errors = [];
  for (const line of snapshot.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!match || properties.has(match[1])) {
      errors.push("Malformed or duplicate systemctl property");
      continue;
    }
    properties.set(match[1], match[2]);
  }
  for (const key of tunnelProperties) {
    if (!properties.has(key)) errors.push(`Missing property: ${key}`);
  }
  const units = (key) =>
    (properties.get(key) ?? "").split(/\s+/).filter(Boolean);
  for (const [key, expected] of [
    ["Id", "cloudflared.service"],
    ["LoadState", "loaded"],
    ["UnitFileState", "enabled"],
    ["Type", "notify"],
    ["Restart", "on-failure"],
  ]) {
    if (properties.get(key) !== expected)
      errors.push(`${key} must be ${expected}`);
  }
  for (const key of ["Wants", "After"]) {
    for (const unit of startupUnits) {
      if (!units(key).includes(unit))
        errors.push(`${key} must include ${unit}`);
    }
  }
  // Any service lifecycle dependency can reintroduce coupling transitively,
  // even when its name is not one of the two API units. Default target/mount
  // requirements from systemd are retained.
  for (const key of [
    "Requires",
    "Requisite",
    "BindsTo",
    "PartOf",
    "Conflicts",
    "ConflictedBy",
    "PropagatesStopTo",
    "StopPropagatedFrom",
  ]) {
    for (const unit of units(key)) {
      if (unit.endsWith(".service"))
        errors.push(`${key} couples service ${unit}`);
    }
  }
  for (const unit of units("Before")) {
    if (startupUnits.includes(unit))
      errors.push(`Before reverses startup ordering for ${unit}`);
  }
  return { ok: errors.length === 0, errors };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--snapshot") {
    process.stderr.write(
      "Usage: node deploy/hetzner/verify-shared-tunnel-dependencies.mjs --snapshot <systemctl-show.txt>\n",
    );
    process.exitCode = 2;
  } else {
    try {
      const result = verifyTunnelDependencies(readFileSync(args[1], "utf8"));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    } catch {
      process.stderr.write("Cannot read tunnel dependency snapshot\n");
      process.exitCode = 2;
    }
  }
}
