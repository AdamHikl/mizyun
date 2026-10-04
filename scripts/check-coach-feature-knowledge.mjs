import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Validate explicit Coach knowledge ownership against the current repository. */
export function validateCoachFeatureKnowledge({
  capabilities,
  internalFeatures,
  featureIds,
  routes,
}) {
  const errors = [];
  const knownFeatures = new Set(featureIds);
  const knownRoutes = new Set(routes);
  const ids = new Set();
  const coveredFeatures = new Set();
  const internalIds = new Set();
  const routeOwners = new Map();
  const nonempty = (value) => typeof value === "string" && value.trim() !== "";

  const registerId = (id) => {
    if (!nonempty(id)) errors.push("Catalog entry has an empty id.");
    else if (ids.has(id)) errors.push(`Duplicate catalog id: ${id}`);
    else ids.add(id);
  };

  for (const capability of capabilities) {
    registerId(capability.id);
    if (!nonempty(capability.guidance)) {
      errors.push(`Capability ${capability.id} has empty guidance.`);
    }
    const localFeatures = new Set();
    for (const featureId of capability.featureIds) {
      if (localFeatures.has(featureId)) {
        errors.push(
          `Duplicate feature reference in ${capability.id}: ${featureId}`,
        );
      }
      localFeatures.add(featureId);
      if (!knownFeatures.has(featureId)) {
        errors.push(`Unknown feature in ${capability.id}: ${featureId}`);
      }
      coveredFeatures.add(featureId);
    }
    for (const route of capability.routes) {
      if (!knownRoutes.has(route)) {
        errors.push(`Unknown route in ${capability.id}: ${route}`);
      }
      if (routeOwners.has(route)) {
        errors.push(
          `Duplicate route ownership: ${route} (${routeOwners.get(route)}, ${capability.id})`,
        );
      } else routeOwners.set(route, capability.id);
    }
  }

  for (const feature of internalFeatures) {
    registerId(feature.id);
    if (!nonempty(feature.reason)) {
      errors.push(`Internal feature ${feature.id} has an empty reason.`);
    }
    if (!knownFeatures.has(feature.id)) {
      errors.push(`Unknown internal feature: ${feature.id}`);
    }
    if (internalIds.has(feature.id)) {
      errors.push(`Duplicate internal feature classification: ${feature.id}`);
    }
    internalIds.add(feature.id);
    if (coveredFeatures.has(feature.id)) {
      errors.push(`Feature is both user-facing and internal: ${feature.id}`);
    }
  }

  for (const featureId of knownFeatures) {
    if (!coveredFeatures.has(featureId) && !internalIds.has(featureId)) {
      errors.push(
        `Feature has no Coach knowledge classification: ${featureId}`,
      );
    }
  }
  for (const route of knownRoutes) {
    if (!routeOwners.has(route)) {
      errors.push(`Mobile route has no Coach capability owner: ${route}`);
    }
  }
  return errors;
}

async function collectRoutes(directory, prefix = "") {
  const routes = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      routes.push(
        ...(await collectRoutes(path.join(directory, entry.name), relative)),
      );
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      entry.name !== "_layout.tsx"
    ) {
      routes.push(relative);
    }
  }
  return routes;
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const catalog = await import(
    pathToFileURL(
      path.join(root, "packages/agent-runtime/src/app-capabilities.ts"),
    ).href
  );
  const featureMap = JSON.parse(
    await readFile(path.join(root, "docs/feature-map.json"), "utf8"),
  );
  const routes = await collectRoutes(path.join(root, "apps/mobile/src/app"));
  const errors = validateCoachFeatureKnowledge({
    capabilities: catalog.COACH_APP_CAPABILITIES,
    internalFeatures: catalog.COACH_INTERNAL_FEATURES,
    featureIds: featureMap.features.map((feature) => feature.id),
    routes,
  });
  if (errors.length > 0) {
    console.error(
      `Coach feature knowledge check failed:\n${errors.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Coach feature knowledge covers ${featureMap.features.length} features and ${routes.length} mobile routes.`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Coach feature knowledge check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
