import fs from "node:fs";
import path from "node:path";

export function getRepoRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "package.json")) &&
      fs.existsSync(path.join(dir, "docs/feature-map.json"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadFeatureMap(repoRoot = getRepoRoot()) {
  const mapPath = path.join(repoRoot, "docs/feature-map.json");
  if (!fs.existsSync(mapPath)) {
    throw new Error(`Feature map not found at ${mapPath}`);
  }

  const raw = fs.readFileSync(mapPath, "utf8");
  const data = JSON.parse(raw);

  if (!data.schemaVersion || data.schemaVersion !== 1) {
    throw new Error(
      `Unsupported feature-map schemaVersion: ${data.schemaVersion}`,
    );
  }

  if (!Array.isArray(data.features)) {
    throw new Error("feature-map.json must contain a 'features' array");
  }

  const featuresById = new Map();
  const featuresByAlias = new Map();

  for (const feature of data.features) {
    if (!feature.id || typeof feature.id !== "string") {
      throw new Error(
        `Invalid feature entry missing id: ${JSON.stringify(feature)}`,
      );
    }
    if (featuresById.has(feature.id)) {
      throw new Error(`Duplicate feature id found: ${feature.id}`);
    }
    featuresById.set(feature.id, feature);

    if (Array.isArray(feature.aliases)) {
      for (const alias of feature.aliases) {
        const normalized = alias.toLowerCase().trim();
        if (!featuresByAlias.has(normalized)) {
          featuresByAlias.set(normalized, []);
        }
        featuresByAlias.get(normalized).push(feature);
      }
    }
  }

  return {
    raw: data,
    schemaVersion: data.schemaVersion,
    features: data.features,
    featuresById,
    featuresByAlias,
  };
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1, // substitution
        );
      }
    }
  }
  return dp[m][n];
}

export function findFeature(mapData, query) {
  if (!query || typeof query !== "string") {
    return { found: false, feature: null, suggestions: [] };
  }

  const normalized = query.toLowerCase().trim();

  // 1. Exact ID match
  if (mapData.featuresById.has(normalized)) {
    return {
      found: true,
      feature: mapData.featuresById.get(normalized),
      suggestions: [],
    };
  }

  // 2. Exact alias match
  if (mapData.featuresByAlias.has(normalized)) {
    const matches = mapData.featuresByAlias.get(normalized);
    if (matches.length === 1) {
      return { found: true, feature: matches[0], suggestions: [] };
    }
    return {
      found: false,
      feature: null,
      suggestions: matches.map((f) => f.id),
      ambiguous: true,
    };
  }

  // 3. Partial or fuzzy matching for suggestions
  const candidates = [];
  for (const feature of mapData.features) {
    if (feature.id.includes(normalized) || normalized.includes(feature.id)) {
      candidates.push({ id: feature.id, dist: 0 });
      continue;
    }
    const dist = levenshteinDistance(normalized, feature.id);
    if (dist <= 3 || dist < feature.id.length / 2) {
      candidates.push({ id: feature.id, dist });
      continue;
    }
    for (const alias of feature.aliases || []) {
      if (alias.toLowerCase().includes(normalized)) {
        candidates.push({ id: feature.id, dist: 1 });
        break;
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  const suggestions = [...new Set(candidates.map((c) => c.id))].slice(0, 5);

  return { found: false, feature: null, suggestions };
}

export function getFeaturesForPath(mapData, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const matchingFeatures = [];

  for (const feature of mapData.features) {
    let matched = false;
    const pathsToCheck = [
      ...(feature.ownedPaths || []),
      ...(feature.entryPoints || []),
      ...(feature.contracts || []),
      ...(feature.domainPort || []),
      ...(feature.api || []),
      ...(feature.ui || []),
      ...(feature.adapters || []),
      ...(feature.tests || []),
    ];

    for (const p of pathsToCheck) {
      const normPrefix = p.replace(/\\/g, "/");
      if (
        normalized === normPrefix ||
        normalized.startsWith(normPrefix + "/") ||
        normPrefix.startsWith(normalized + "/")
      ) {
        matched = true;
        break;
      }
    }

    if (matched) {
      matchingFeatures.push(feature);
    }
  }

  return matchingFeatures;
}
