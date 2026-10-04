#!/usr/bin/env node
// Pinned API contract: https://github.com/metabase/metabase/releases/tag/v0.63.18.2
// Metabase API is unversioned. Reverify tagged API definitions before upgrading.
import { pathToFileURL } from "node:url";

export const METABASE_VERSION = "v0.63.18.2";
export const MANAGED = "mizyun:aggregate-dashboard:v1";
export const COLLECTION_NAME = "Mizyun developer analytics";
export const DASHBOARD_NAME = "Mizyun founder dashboard";
export const DATABASE_NAME =
  "Mizyun aggregate reporting [mizyun:aggregate-dashboard:v1]";
const marker = (id) => `[${MANAGED}:${id}]`;
const description = (id, text) => `${marker(id)} ${text}`;

export function readConfig(env = process.env) {
  const required = (key) => {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}`);
    return env[key];
  };
  let url;
  try {
    url = new URL(required("METABASE_URL"));
  } catch {
    throw new Error("Invalid METABASE_URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!loopback && url.protocol !== "https:") ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error(
      "METABASE_URL must be an HTTPS origin or loopback HTTP origin without credentials",
    );
  }
  const host = required("REPORTING_DB_HOST");
  // Dedicated compose network/loopback only; no Supabase source connections.
  if (!["postgres", "localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error("Reporting host must be dedicated postgres or loopback");
  const dbname = required("REPORTING_DB_NAME");
  const user = required("REPORTING_DB_USER");
  if (dbname !== "mizyun_reporting" || user !== "reporting_reader")
    throw new Error(
      "Only the dedicated reporting database and reader are allowed",
    );
  const port = Number(required("REPORTING_DB_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid REPORTING_DB_PORT");
  return {
    url: url.origin,
    apiKey: required("METABASE_API_KEY"),
    details: {
      host,
      port,
      dbname,
      user,
      password: required("REPORTING_DB_PASSWORD"),
      ssl: false,
    },
  };
}

export function createApi(config, fetchImpl = fetch) {
  return async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(`${config.url}/api${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.apiKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`Metabase ${method} ${path} transport failed`);
    }
    // Never echo remote errors: connection validation can return credentials.
    if (!response.ok)
      throw new Error(
        `Metabase ${method} ${path} failed (HTTP ${response.status})`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error(`Metabase ${method} ${path} returned invalid JSON`);
    }
  };
}

export const PARAMETER_SQL = `WITH p AS (
  SELECT CASE WHEN {{environment}} IN ('dev','prod','synthetic') THEN {{environment}} ELSE NULL END AS environment,
    CASE WHEN {{days}} BETWEEN 1 AND 30 AND {{days}} = trunc({{days}}::numeric)
      THEN {{days}}::integer ELSE NULL END AS days
)`;
const windowSql =
  "m.day >= (now() AT TIME ZONE 'UTC')::date - (p.days - 1) AND m.day <= (now() AT TIME ZONE 'UTC')::date";
function metricsSql(select, where, group, order = group) {
  return `${PARAMETER_SQL}\nSELECT ${select}\nFROM reporting.metrics m CROSS JOIN p\nWHERE m.environment = p.environment AND ${windowSql} AND ${where}\nGROUP BY ${group}\nORDER BY ${order}`;
}
const metricNames = (names) => names.map((name) => `'${name}'`).join(",");
const series = (names) =>
  metricsSql(
    "m.day, m.metric, sum(m.value) AS count",
    `m.platform = 'all' AND m.dimension = 'all' AND m.metric IN (${metricNames(names)})`,
    "m.day, m.metric",
  );
const ranking = (name) =>
  metricsSql(
    "m.dimension, sum(m.value) AS count",
    `m.platform = 'all' AND m.dimension <> 'all' AND m.metric = '${name}'`,
    "m.dimension",
    "count DESC, m.dimension",
  );
const tagged = (id, name, sql, note, display = "table", settings = {}) => ({
  id,
  name,
  sql,
  note,
  display,
  settings,
});

export const CARD_DEFINITIONS = [
  tagged(
    "coverage",
    "Snapshot freshness and analytics coverage",
    `${PARAMETER_SQL}
SELECT f.generated_at,
  CASE WHEN f.generated_at IS NULL THEN 'Unavailable: no snapshot'
       WHEN f.generated_at < now() - interval '2 hours' THEN 'STALE: event charts suppressed'
       ELSE 'Fresh snapshot' END AS freshness,
  CASE WHEN f.generated_at >= now() - interval '2 hours' THEN f.total_accounts END AS existing_accounts,
  CASE WHEN f.generated_at >= now() - interval '2 hours' THEN f.consenting_accounts END AS consenting_accounts,
  CASE WHEN f.generated_at >= now() - interval '2 hours' THEN round(100.0 * f.consenting_accounts / nullif(f.total_accounts, 0), 1) END AS consent_coverage_percent
FROM p LEFT JOIN reporting.refreshes f ON f.environment = p.environment`,
    "Existing Auth accounts include unconfirmed accounts and exclude deleted accounts. Activity covers consenting observed accounts only; consent coverage is not a response rate.",
  ),
  tagged(
    "registrations",
    "Daily registrations — existing Auth accounts",
    series(["registrations"]),
    "Account creation dates for currently existing Auth accounts, including unconfirmed accounts; deleted accounts are excluded.",
    "line",
  ),
  tagged(
    "activity",
    "Daily observed active accounts and sessions",
    series(["active_accounts", "sessions"]),
    "Consenting retained observed activity only; sessions are observed session events.",
    "line",
  ),
  tagged(
    "logs",
    "Daily observed manual meals, workouts and body records",
    series(["meals_logged", "workouts_logged", "body_records_logged"]),
    "Consenting observed successful manual logging events only. Workout finishes are visit outcomes; retries or later visits may recount a persisted record, so these are not unique record counts. Recurring server-created meals are excluded. Counts do not prove food intake or adherence.",
    "line",
  ),
  tagged(
    "screens",
    "Most viewed screens",
    ranking("screen_views"),
    "Closed screen identifiers; observed screen view counts, not distinct visitors.",
    "bar",
    { "graph.dimensions": ["dimension"], "graph.metrics": ["count"] },
  ),
  tagged(
    "clicks",
    "Most clicked dashboard widgets",
    ranking("dashboard_clicks"),
    "Closed dashboard control identifiers; repeated clicks are counted.",
    "bar",
    { "graph.dimensions": ["dimension"], "graph.metrics": ["count"] },
  ),
  tagged(
    "searches",
    "Settings search result coverage",
    ranking("settings_searches"),
    "Only result-count buckets none / 1_to_5 / 6_plus are captured. Search text is never collected. No-result searches can suggest findability issues.",
  ),
  tagged(
    "selections",
    "Settings selected after search",
    ranking("settings_selections"),
    "Closed setting destination identifiers selected after search; this does not reveal exact search phrases.",
    "bar",
    { "graph.dimensions": ["dimension"], "graph.metrics": ["count"] },
  ),
  tagged(
    "flows",
    "Logging flow observations",
    metricsSql(
      "m.dimension AS flow, m.metric, sum(m.value) AS count",
      `m.platform = 'all' AND m.dimension <> 'all' AND m.metric IN ('flow_started','flow_completed','flow_failed','flow_exited')`,
      "m.dimension, m.metric",
    ),
    "Uncorrelated event counts. Starts, completions, failures and explicit exits are not a matched funnel or abandonment rate. App termination is unknown.",
  ),
  tagged(
    "attempts",
    "Matched journeys — completed, exited or outcome unknown",
    metricsSql(
      `m.dimension AS journey,
       sum(m.value) FILTER (WHERE m.metric='attempts_started') AS started,
       coalesce(sum(m.value) FILTER (WHERE m.metric='attempts_completed'),0) AS completed,
       coalesce(sum(m.value) FILTER (WHERE m.metric='attempts_exited'),0) AS explicit_exits,
       coalesce(sum(m.value) FILTER (WHERE m.metric='attempts_open'),0) AS outcome_unknown,
       coalesce(sum(m.value) FILTER (WHERE m.metric='attempts_failed'),0) AS attempts_with_failure,
       round(100.0 * coalesce(sum(m.value) FILTER (WHERE m.metric='attempts_completed'),0) / nullif(sum(m.value) FILTER (WHERE m.metric='attempts_started'),0),1) AS observed_completion_percent`,
      "m.platform='all' AND m.metric IN ('attempts_started','attempts_completed','attempts_exited','attempts_open','attempts_failed')",
      "m.dimension",
    ),
    "Scoped consenting attempts grouped by their start day. Earliest observed completion or explicit exit wins; failures may recover. Unknown includes termination, offline loss and unfinished attempts, never inferred abandonment. Workout counts are screen visits. Legacy unscoped events and starts outside retention are excluded.",
  ),
  tagged(
    "onboarding_steps",
    "Setup steps completed",
    ranking("onboarding_steps"),
    "Static step identifiers only, with repeated visits deduplicated by the new client per attempt. A start begins when consent is granted, so earlier declined steps are unobserved. Final goal step requires successful persistence.",
    "bar",
    { "graph.dimensions": ["dimension"], "graph.metrics": ["count"] },
  ),
  tagged(
    "onboarding_friction",
    "Setup failures and explicit exits by step",
    metricsSql(
      "m.dimension AS step, m.metric, sum(m.value) AS count",
      "m.platform='all' AND m.metric IN ('onboarding_failures','onboarding_exits')",
      "m.dimension, m.metric",
    ),
    "Observed static step outcomes only; no setup form values. A failed save can later succeed. An explicit Exit differs from an unknown outcome after app termination.",
  ),
  tagged(
    "failures",
    "Logging failures by coarse reason",
    ranking("failures"),
    "Closed flow and reason identifiers. A failure event may be followed by successful recovery; users getting lost cannot be inferred from counts alone.",
  ),
  tagged(
    "duration",
    "Logging completion duration buckets",
    ranking("duration_bucket"),
    "Coarse flow>bucket values from observed completed attempts. No exact durations or full interaction replay.",
  ),
  tagged(
    "navigation",
    "Observed navigation paths",
    ranking("navigation"),
    "Closed screen>screen pairs. Counts do not identify individuals or prove why a journey ended.",
  ),
  tagged(
    "retention",
    "Observed D1 / D7 return — matured cohorts",
    metricsSql(
      `m.day AS first_observed_day,
  max(CASE WHEN m.metric = 'd1_eligible' THEN m.value END) AS d1_matured_eligible,
  max(CASE WHEN m.metric = 'd1_returned' THEN m.value END) AS d1_returned,
  round(100.0 * max(CASE WHEN m.metric = 'd1_returned' THEN m.value END) / nullif(max(CASE WHEN m.metric = 'd1_eligible' THEN m.value END), 0), 1) AS d1_return_percent,
  max(CASE WHEN m.metric = 'd7_eligible' THEN m.value END) AS d7_matured_eligible,
  max(CASE WHEN m.metric = 'd7_returned' THEN m.value END) AS d7_returned,
  round(100.0 * max(CASE WHEN m.metric = 'd7_returned' THEN m.value END) / nullif(max(CASE WHEN m.metric = 'd7_eligible' THEN m.value END), 0), 1) AS d7_return_percent`,
      `m.platform = 'all' AND m.dimension = 'all' AND m.metric IN ('d1_eligible','d1_returned','d7_eligible','d7_returned')`,
      "m.day",
    ),
    "First observed consenting event within retained 30-day window, not signup cohorts. Only matured cohorts enter denominators; zero or absent denominators show missing percentages. Rolling retention can shift the first observed date.",
  ),
  tagged(
    "releases",
    "Observed app releases",
    ranking("releases"),
    "Version/build dimensions describe retained observed events, not installation or download counts. Unknown versions remain unknown.",
  ),
  tagged(
    "actions",
    "Feature action outcomes",
    ranking("feature_actions"),
    "Closed action>success|failure identifiers; uninstrumented actions remain unobserved.",
  ),
  tagged(
    "stores",
    "Imported Apple / Google store metrics",
    `${PARAMETER_SQL}
SELECT m.platform, m.day, m.metric, m.value, m.source, m.imported_at
FROM reporting.store_metrics m CROSS JOIN p
WHERE p.environment = 'prod' AND ${windowSql}
ORDER BY m.day, m.platform, m.metric`,
    "Production store aggregates only. Empty results mean no imported rows for this window, not zero downloads. Apple and Google definitions may differ; compare like metrics and source periods.",
  ),
];

export const DASHBOARD_PARAMETERS = [
  {
    id: "environment",
    name: "Environment",
    slug: "environment",
    type: "string/=",
    default: "synthetic",
    values_source_type: "static-list",
    values_source_config: { values: ["synthetic", "dev", "prod"] },
  },
  {
    id: "days",
    name: "Days (1–30, UTC)",
    slug: "days",
    type: "number/=",
    default: 30,
  },
];
const PREVIOUS_SECURITY_TEXT = `## Private developer analytics
Authenticated founder access only. No public sharing or embedding. The only database connection is the dedicated read-only aggregate warehouse; it contains no account identifiers, emails, photos, health values, free text or search phrases.

Choose **synthetic** for fixture data, **dev** for development, or **prod** for Production. Days must be an integer from 1 to 30; all dates are UTC. Missing rows mean unavailable or unobserved data, not zero. Stale source snapshots over two hours suppress event charts. Store imports have their own source timestamps and appear only for prod.

Activity describes consenting, instrumented users within retained events, not the entire user base. Manual meal events exclude scheduled server-created meals. Flow and navigation counts are uncorrelated observations; they cannot prove abandonment, user intent or why users got lost. D1/D7 return uses first observed activity inside the rolling 30-day window, not signup cohorts. Store downloads require separately imported official reports.`;

export const SECURITY_TEXT = `## Developer analytics
**Synthetic = simulated demo data.** Dev and Production are unavailable until connected. Store downloads require real official reports.

Activity covers consenting observed usage. Matched journeys distinguish explicit exits from unknown outcomes; unknown is not abandonment. All dates are UTC, 1–30 days. Snapshots expire after two hours: refresh this Mac preview with the local command.

Private administrator access; aggregate-only database, no health values or search text. No public sharing or embedding.`;

export const LIVE_SECURITY_TEXT = `## Developer analytics
**Real app summaries from Hetzner.** Choose Production or Dev; the coverage card shows the latest successful refresh. Empty or unavailable measurements are not zero. Downloads require separately imported official store reports.

Activity covers consenting observed usage. Matched journeys distinguish explicit exits from unknown outcomes; unknown is not abandonment. All dates are UTC, 1–30 days. Snapshots expire after two hours: refresh with the Mac dashboard command.

Private administrator access; aggregate-only database, no health values or search text. No public sharing or embedding.`;

function singleManaged(items, name, id) {
  const matches = items.filter(
    (item) => item.name === name || item.description?.startsWith(marker(id)),
  );
  if (
    matches.length > 1 ||
    (matches[0] &&
      (matches[0].name !== name ||
        !matches[0].description?.startsWith(`${marker(id)} `) ||
        matches[0].archived))
  )
    throw new Error(`Managed ${id} collision; no overwrite permitted`);
  return matches[0];
}
function list(value, context) {
  const items = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(items))
    throw new Error(`Unexpected Metabase ${context} response`);
  return items;
}
const validId = (value) => Number.isInteger(value) && value > 0;

async function collectionInventory(api, archived) {
  // v0.63.18.2 /collection (active or archived) throws for API-key principals
  // once collections exist because personal collection ids are null. AppDB search is the pinned
  // working endpoint; forcing appdb avoids asynchronously indexed ownership.
  // https://github.com/metabase/metabase/blob/v0.63.18.2/src/metabase/search/api.clj
  const all = [];
  const kind = archived ? "Archived" : "Active";
  let expectedTotal;
  for (let offset = 0; offset < 10_000; offset += 100) {
    const page = await api(
      "GET",
      `/search?models=collection&archived=${archived}&search_engine=appdb&limit=100&offset=${offset}`,
    );
    if (
      !Array.isArray(page.data) ||
      !Number.isInteger(page.total) ||
      page.total < 0 ||
      page.offset !== offset ||
      page.limit !== 100 ||
      page.engine !== "search.engine/appdb" ||
      page.data.some(
        (item) =>
          item.model !== "collection" ||
          item.archived !== archived ||
          !validId(item.id),
      )
    )
      throw new Error(
        `Invalid ${kind.toLowerCase()} collection search response; ownership not verified`,
      );
    expectedTotal ??= page.total;
    if (
      page.total !== expectedTotal ||
      (page.data.length === 0 && offset < page.total)
    )
      throw new Error(
        `${kind} collection inventory changed or is incomplete; retry provisioning`,
      );
    all.push(...page.data);
    if (all.length >= page.total) {
      if (
        all.length !== page.total ||
        new Set(all.map((item) => item.id)).size !== all.length
      )
        throw new Error(`${kind} collection inventory is inconsistent`);
      return all;
    }
  }
  throw new Error(
    `${kind} collection inventory exceeds safe bound; ownership not verified`,
  );
}
export const archivedCollections = (api) => collectionInventory(api, true);
export const activeCollections = (api) => collectionInventory(api, false);

export async function provision(
  config,
  { api = createApi(config), defaultEnvironment = "synthetic" } = {},
) {
  if (!["synthetic", "dev", "prod"].includes(defaultEnvironment))
    throw new Error("Invalid dashboard default environment");
  const live = defaultEnvironment !== "synthetic";
  const parameters = DASHBOARD_PARAMETERS.map((parameter) =>
    parameter.id === "environment"
      ? {
          ...parameter,
          default: defaultEnvironment,
          values_source_config: {
            values: live ? ["dev", "prod"] : ["synthetic", "dev", "prod"],
          },
        }
      : { ...parameter },
  );
  const securityText = live ? LIVE_SECURITY_TEXT : SECURITY_TEXT;
  const properties = await api("GET", "/session/properties");
  if (properties.version?.tag !== METABASE_VERSION)
    throw new Error(
      `Expected pinned Metabase ${METABASE_VERSION}; upgrade API must be reverified`,
    );
  if (
    properties["enable-public-sharing"] === true ||
    properties["enable-embedding"] === true ||
    properties["enable-embedding-static"] === true ||
    properties["enable-embedding-interactive"] === true
  )
    throw new Error("Disable public sharing and embedding before provisioning");
  // Preflight content ownership before any content writes.
  const databases = list(await api("GET", "/database"), "databases");
  const existingDatabases = databases.filter((db) => db.name === DATABASE_NAME);
  if (existingDatabases.length > 1)
    throw new Error("Managed database collision");
  let database = existingDatabases[0];
  if (database) {
    database = await api("GET", `/database/${database.id}`);
    if (
      database.engine !== "postgres" ||
      ["host", "port", "dbname", "user", "ssl"].some(
        (key) => database.details?.[key] !== config.details[key],
      )
    )
      throw new Error(
        "Existing managed database targets a different connection; no overwrite permitted",
      );
  }
  const collections = [
    ...(await activeCollections(api)),
    ...(await archivedCollections(api)),
  ];
  let collection = singleManaged(collections, COLLECTION_NAME, "collection");
  const cards = [
    ...list(await api("GET", "/card?f=all"), "cards"),
    ...list(await api("GET", "/card?f=archived"), "archived cards"),
  ];
  const existingCards = CARD_DEFINITIONS.map((card) =>
    singleManaged(cards, card.name, card.id),
  );
  let dashboard = singleManaged(
    [
      ...list(await api("GET", "/dashboard"), "dashboards"),
      ...list(await api("GET", "/dashboard?f=archived"), "archived dashboards"),
    ],
    DASHBOARD_NAME,
    "dashboard",
  );
  for (const card of existingCards.filter(Boolean)) {
    const details = await api("GET", `/card/${card.id}`);
    if (details.public_uuid || details.enable_embedding)
      throw new Error(
        "Managed card is shared or embedded; revoke it before provisioning",
      );
  }
  for (const object of [...existingCards.filter(Boolean), dashboard].filter(
    Boolean,
  )) {
    if (object.collection_id !== collection?.id || !collection)
      throw new Error("Managed content is outside the managed collection");
    if (object.public_uuid || object.enable_embedding)
      throw new Error(
        "Managed content is publicly shared or embedded; revoke it before provisioning",
      );
  }
  let storedDashboard;
  if (dashboard) {
    storedDashboard = await api("GET", `/dashboard/${dashboard.id}`);
    if (storedDashboard.public_uuid || storedDashboard.enable_embedding)
      throw new Error("Managed dashboard is shared or embedded");
    const knownIds = new Set(
      existingCards.filter(Boolean).map((card) => card.id),
    );
    if (
      storedDashboard.tabs?.length ||
      storedDashboard.dashcards?.some((dc) =>
        dc.card_id
          ? !knownIds.has(dc.card_id)
          : ![
              SECURITY_TEXT,
              LIVE_SECURITY_TEXT,
              PREVIOUS_SECURITY_TEXT,
            ].includes(dc.visualization_settings?.text),
      )
    )
      throw new Error(
        "Dashboard contains unmanaged cards or tabs; no overwrite permitted",
      );
  }
  const groups = list(
    await api("GET", "/permissions/group"),
    "permission groups",
  );
  const admins = groups.filter((group) => group.name === "Administrators");
  if (admins.length !== 1 || !validId(admins[0].id))
    throw new Error("Cannot identify Administrators group");
  if (!database)
    database = await api("POST", "/database", {
      name: DATABASE_NAME,
      engine: "postgres",
      details: config.details,
      is_full_sync: false,
      is_on_demand: false,
      auto_run_queries: true,
    });
  if (!validId(database.id)) throw new Error("Invalid database id");
  // Collection permissions protect saved cards, but /api/dataset also needs
  // database query permissions. OSS supports create-queries=no; view-data=blocked
  // requires a paid feature and is deliberately not used here.
  const dataGraph = await api("GET", "/permissions/graph");
  if (!Number.isInteger(dataGraph.revision) || !dataGraph.groups)
    throw new Error("Invalid database permissions graph");
  const dataPermissions = structuredClone(dataGraph.groups);
  for (const group of groups.filter((group) => group.id !== admins[0].id)) {
    dataPermissions[group.id] ??= {};
    dataPermissions[group.id][database.id] = {
      ...dataPermissions[group.id][database.id],
      "create-queries": "no",
      details: "no",
      transforms: "no",
    };
  }
  await api("PUT", "/permissions/graph", {
    revision: dataGraph.revision,
    groups: dataPermissions,
  });
  const effectiveDataGraph = await api("GET", "/permissions/graph");
  if (
    !Number.isInteger(effectiveDataGraph.revision) ||
    effectiveDataGraph.revision < dataGraph.revision ||
    !effectiveDataGraph.groups ||
    typeof effectiveDataGraph.groups !== "object" ||
    Array.isArray(effectiveDataGraph.groups)
  )
    throw new Error("Invalid effective database permissions graph");
  for (const group of groups.filter((group) => group.id !== admins[0].id)) {
    const groupAccess = Object.hasOwn(effectiveDataGraph.groups, group.id)
      ? effectiveDataGraph.groups[group.id]
      : {};
    if (
      !groupAccess ||
      typeof groupAccess !== "object" ||
      Array.isArray(groupAccess)
    )
      throw new Error("Invalid effective database group permissions");
    const access = Object.hasOwn(groupAccess, database.id)
      ? groupAccess[database.id]
      : {};
    // Tagged rename-perm/rename-or-ellide-kv deliberately omit least-permissive
    // values. For these three keys the schema's least-permissive value is :no.
    // Empty group/db maps may also be pruned by reduce-into-graph. Explicit
    // nulls, granular grants or stronger scalar values are not implicit denial.
    // https://github.com/metabase/metabase/blob/v0.63.18.2/src/metabase/permissions_rest/data_permissions/graph.clj
    if (
      !access ||
      typeof access !== "object" ||
      Array.isArray(access) ||
      ["create-queries", "details", "transforms"].some(
        (key) => Object.hasOwn(access, key) && access[key] !== "no",
      )
    )
      throw new Error(
        "Managed database query permissions did not become private",
      );
  }
  const warehouse = await api("POST", "/dataset", {
    database: database.id,
    type: "native",
    native: {
      query: `SELECT current_database(), current_user,
  (SELECT count(*) FROM information_schema.tables t
   WHERE t.table_schema NOT IN ('pg_catalog','information_schema')
     AND has_table_privilege(current_user, quote_ident(t.table_schema)||'.'||quote_ident(t.table_name), 'SELECT')
     AND NOT (t.table_schema = 'reporting' AND t.table_name IN ('metrics','refreshes','store_metrics'))) AS unsafe_readable_tables`,
    },
  });
  const row = warehouse.data?.rows?.[0];
  if (
    warehouse.status !== "completed" ||
    row?.[0] !== "mizyun_reporting" ||
    row?.[1] !== "reporting_reader" ||
    Number(row?.[2]) !== 0
  )
    throw new Error(
      "Reporting connection is not the expected restricted aggregate reader",
    );
  if (!collection)
    collection = await api("POST", "/collection", {
      name: COLLECTION_NAME,
      description: description(
        "collection",
        "Managed private aggregate analytics. Restrict collection access to founder/admins.",
      ),
      color: "#509EE3",
    });
  if (!validId(collection.id)) throw new Error("Invalid collection id");
  // Default All Users permissions must not expose the founder collection. Only
  // this collection changes; optimistic revision avoids overwriting concurrent edits.
  const graph = await api("GET", "/collection/graph");
  if (!Number.isInteger(graph.revision) || !graph.groups)
    throw new Error("Invalid collection permissions graph");
  const permissions = structuredClone(graph.groups);
  for (const group of groups) {
    permissions[group.id] ??= {};
    permissions[group.id][collection.id] =
      group.id === admins[0].id ? "write" : "none";
  }
  await api("PUT", "/collection/graph", {
    revision: graph.revision,
    groups: permissions,
  });
  const ids = [];
  for (let index = 0; index < CARD_DEFINITIONS.length; index++) {
    const card = CARD_DEFINITIONS[index];
    const body = {
      name: card.name,
      description: description(card.id, card.note),
      collection_id: collection.id,
      display: card.display,
      visualization_settings:
        card.display === "line"
          ? {
              "graph.dimensions": ["day", "metric"],
              "graph.metrics": ["count"],
              ...card.settings,
            }
          : card.settings,
      type: "question",
      dataset_query: {
        database: database.id,
        type: "native",
        native: {
          query: card.sql,
          "template-tags": {
            environment: {
              id: "environment",
              name: "environment",
              "display-name": "Environment",
              type: "text",
              default: defaultEnvironment,
              required: true,
            },
            days: {
              id: "days",
              name: "days",
              "display-name": "Days (1–30)",
              type: "number",
              default: 30,
              required: true,
            },
          },
        },
      },
    };
    const result = await api(
      existingCards[index] ? "PUT" : "POST",
      existingCards[index] ? `/card/${existingCards[index].id}` : "/card",
      body,
    );
    if (!validId(result.id)) throw new Error("Invalid card id");
    ids.push(result.id);
  }
  if (!dashboard)
    dashboard = await api("POST", "/dashboard", {
      name: DASHBOARD_NAME,
      description: description(
        "dashboard",
        "Private founder dashboard. Aggregate-only data with explicit coverage and missing-source limitations.",
      ),
      collection_id: collection.id,
      parameters,
    });
  if (!validId(dashboard.id)) throw new Error("Invalid dashboard id");
  const oldCards = storedDashboard?.dashcards ?? [];
  const dashcards = [
    {
      id: oldCards.find((dc) => !dc.card_id)?.id ?? -1,
      card_id: null,
      row: 0,
      col: 0,
      size_x: 24,
      size_y: 4,
      visualization_settings: {
        text: securityText,
        virtual_card: { display: "text" },
      },
      parameter_mappings: [],
    },
    ...ids.map((cardId, index) => ({
      id: oldCards.find((dc) => dc.card_id === cardId)?.id ?? -(index + 2),
      card_id: cardId,
      row: 4 + Math.floor(index / 2) * 6,
      col: (index % 2) * 12,
      size_x: 12,
      size_y: 6,
      visualization_settings: {},
      parameter_mappings: ["environment", "days"].map((id) => ({
        parameter_id: id,
        card_id: cardId,
        target: ["variable", ["template-tag", id]],
      })),
    })),
  ];
  await api("PUT", `/dashboard/${dashboard.id}`, {
    parameters,
    enable_embedding: false,
    width: "full",
    dashcards,
  });
  return {
    dashboardId: dashboard.id,
    cardCount: ids.length,
    url: `${config.url}/dashboard/${dashboard.id}`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await provision(readConfig());
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
