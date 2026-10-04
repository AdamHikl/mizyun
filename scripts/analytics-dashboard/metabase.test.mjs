import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_DEFINITIONS,
  COLLECTION_NAME,
  DASHBOARD_NAME,
  DATABASE_NAME,
  METABASE_VERSION,
  SECURITY_TEXT,
  LIVE_SECURITY_TEXT,
  activeCollections,
  archivedCollections,
  createApi,
  provision,
  readConfig,
} from "./metabase.mjs";

const environment = {
  METABASE_URL: "http://127.0.0.1:3033",
  METABASE_API_KEY: "fixture-secret-api",
  REPORTING_DB_HOST: "postgres",
  REPORTING_DB_PORT: "5432",
  REPORTING_DB_NAME: "mizyun_reporting",
  REPORTING_DB_USER: "reporting_reader",
  REPORTING_DB_PASSWORD: "fixture-secret-db",
};
const config = () => readConfig(environment);
function fixture() {
  const state = {
    databases: [],
    collections: [],
    cards: [],
    dashboards: [],
    requests: [],
    revision: 3,
    groups: { 1: { root: "read" }, 2: { root: "write" }, 9: { root: "none" } },
    dataRevision: 5,
    dataGroups: {
      1: { 777: { "create-queries": "query-builder-and-native" } },
      2: {},
      9: {},
    },
    version: METABASE_VERSION,
    unsafe: 0,
  };
  let nextId = 1;
  const api = async (method, path, body) => {
    state.requests.push({ method, path, body: structuredClone(body) });
    if (method === "GET") {
      if (path === "/session/properties")
        return {
          version: { tag: state.version },
          "enable-public-sharing": false,
          "enable-embedding": false,
        };
      if (path === "/database") return { data: state.databases };
      if (path === "/collection")
        throw new Error("Pinned API-key collection enumeration bug");
      if (path.startsWith("/search?models=collection&archived=")) {
        const offset = Number(
          new URL(path, "http://fixture.invalid").searchParams.get("offset"),
        );
        const archived =
          new URL(path, "http://fixture.invalid").searchParams.get(
            "archived",
          ) === "true";
        const entries = state.collections
          .filter((x) => Boolean(x.archived) === archived)
          .map((x) => ({
            ...x,
            archived: Boolean(x.archived),
            model: "collection",
          }));
        return {
          data: entries.slice(offset, offset + 100),
          limit: 100,
          offset,
          total: entries.length,
          engine: "search.engine/appdb",
        };
      }
      if (path === "/card?f=all") return state.cards.filter((x) => !x.archived);
      if (path === "/card?f=archived")
        return state.cards.filter((x) => x.archived);
      if (path === "/dashboard")
        return state.dashboards.filter((x) => !x.archived);
      if (path === "/dashboard?f=archived")
        return state.dashboards.filter((x) => x.archived);
      if (path === "/permissions/group")
        return [
          { id: 1, name: "All Users" },
          { id: 2, name: "Administrators" },
          { id: 9, name: "Future testers" },
        ];
      if (path === "/collection/graph")
        return { revision: state.revision, groups: state.groups };
      if (path === "/permissions/graph")
        return { revision: state.dataRevision, groups: state.dataGroups };
      const match = /^\/(database|card|dashboard)\/(\d+)$/.exec(path);
      if (match)
        return state[
          { database: "databases", card: "cards", dashboard: "dashboards" }[
            match[1]
          ]
        ].find((x) => x.id === Number(match[2]));
    }
    if (method === "POST" && path === "/dataset")
      return {
        status: "completed",
        data: {
          rows: [["mizyun_reporting", "reporting_reader", state.unsafe]],
        },
      };
    if (
      method === "POST" &&
      ["/database", "/collection", "/card", "/dashboard"].includes(path)
    ) {
      const value = { id: nextId++, ...structuredClone(body) };
      state[
        {
          "/database": "databases",
          "/collection": "collections",
          "/card": "cards",
          "/dashboard": "dashboards",
        }[path]
      ].push(value);
      if (path === "/database") {
        for (const group of Object.values(state.dataGroups)) {
          group[value.id] = {
            "view-data": "unrestricted",
            "create-queries": "query-builder-and-native",
            details: "yes",
            transforms: "yes",
          };
        }
      }
      return value;
    }
    if (method === "PUT" && path === "/permissions/graph") {
      assert.equal(body.revision, state.dataRevision);
      state.dataGroups = structuredClone(body.groups);
      state.dataRevision++;
      return { revision: state.dataRevision, groups: state.dataGroups };
    }
    if (method === "PUT" && path === "/collection/graph") {
      assert.equal(body.revision, state.revision);
      state.groups = structuredClone(body.groups);
      state.revision++;
      return { revision: state.revision, groups: state.groups };
    }
    const match = /^\/(card|dashboard)\/(\d+)$/.exec(path);
    if (method === "PUT" && match) {
      const value = state[match[1] === "card" ? "cards" : "dashboards"].find(
        (x) => x.id === Number(match[2]),
      );
      Object.assign(value, structuredClone(body));
      // Metabase persists newly created negative dashcard ids as positive ids.
      if (body.dashcards)
        value.dashcards = body.dashcards.map((dc) => ({
          ...dc,
          id: dc.id < 0 ? nextId++ : dc.id,
        }));
      return value;
    }
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  };
  return { state, api };
}

test("configuration accepts secure origins and only dedicated reader; refuses exfiltration targets", () => {
  assert.equal(config().details.dbname, "mizyun_reporting");
  assert.equal(
    readConfig({
      ...environment,
      METABASE_URL: "https://analytics.phiskel.com",
    }).url,
    "https://analytics.phiskel.com",
  );
  for (const url of [
    "http://analytics.phiskel.com",
    "https://user:secret@analytics.phiskel.com",
    "https://analytics.phiskel.com/path",
    "https://analytics.phiskel.com?key=secret",
    "file:///tmp/key",
  ])
    assert.throws(
      () => readConfig({ ...environment, METABASE_URL: url }),
      /METABASE_URL/,
    );
  for (const changes of [
    { REPORTING_DB_NAME: "postgres" },
    { REPORTING_DB_USER: "supabase_admin" },
    { REPORTING_DB_HOST: "supabase.phiskel.com" },
    { REPORTING_DB_PORT: "5432x" },
    { REPORTING_DB_PORT: "65536" },
  ])
    assert.throws(() => readConfig({ ...environment, ...changes }));
});

test("transport sends API key once, forbids redirects and redacts remote/transport errors", async () => {
  let request;
  const api = createApi(config(), async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.deepEqual(await api("GET", "/session/properties"), { ok: true });
  assert.equal(request.url, "http://127.0.0.1:3033/api/session/properties");
  assert.equal(request.init.headers["X-API-Key"], environment.METABASE_API_KEY);
  assert.equal(request.init.redirect, "error");
  await assert.rejects(
    createApi(
      config(),
      async () =>
        new Response(environment.REPORTING_DB_PASSWORD, { status: 400 }),
    )("POST", "/database"),
    { message: "Metabase POST /database failed (HTTP 400)" },
  );
  await assert.rejects(
    createApi(config(), async () => {
      throw new Error(environment.METABASE_API_KEY);
    })("GET", "/database"),
    { message: "Metabase GET /database transport failed" },
  );
});

test("provisioning uses aggregate-only connection and private collection, reruns retain object identities", async () => {
  const { state, api } = fixture();
  const first = await provision(config(), { api });
  assert.equal(first.cardCount, CARD_DEFINITIONS.length);
  assert.equal(state.databases[0].engine, "postgres");
  assert.equal(state.databases[0].details.user, "reporting_reader");
  assert.equal(state.collections[0].name, COLLECTION_NAME);
  const collectionId = state.collections[0].id;
  assert.equal(state.groups[1][collectionId], "none");
  assert.equal(state.groups[9][collectionId], "none");
  assert.equal(state.groups[2][collectionId], "write");
  assert.equal(state.groups[1].root, "read");
  const dashboard = state.dashboards[0];
  assert.equal(dashboard.name, DASHBOARD_NAME);
  assert.equal(dashboard.enable_embedding, false);
  assert.equal(
    dashboard.dashcards[0].visualization_settings.text,
    SECURITY_TEXT,
  );
  assert.equal(dashboard.parameters[0].default, "synthetic");
  assert.equal(dashboard.parameters[1].default, 30);
  const dashcardIds = dashboard.dashcards.map((dc) => dc.id);
  const second = await provision(config(), { api });
  assert.deepEqual(second, first);
  assert.equal(state.databases.length, 1);
  assert.equal(state.collections.length, 1);
  assert.equal(state.cards.length, CARD_DEFINITIONS.length);
  assert.equal(state.dashboards.length, 1);
  assert.deepEqual(
    dashboard.dashcards.map((dc) => dc.id),
    dashcardIds,
  );
  assert.equal(
    state.requests.some((r) => /public_link|embed/.test(r.path)),
    false,
  );
});

test("name collision is detected before any write, including archived content", async () => {
  for (const bucket of ["collections", "cards", "dashboards"]) {
    const { state, api } = fixture();
    state[bucket].push({
      id: 99,
      name: {
        collections: COLLECTION_NAME,
        cards: CARD_DEFINITIONS[0].name,
        dashboards: DASHBOARD_NAME,
      }[bucket],
      description: "Human-owned data",
      archived: bucket === "cards",
    });
    await assert.rejects(provision(config(), { api }), /collision/);
    assert.equal(
      state.requests.some((r) => r.method !== "GET"),
      false,
    );
  }
});

test("archived collection collision beyond first page is detected through API-key compatible direct search", async () => {
  const { state, api } = fixture();
  state.collections = Array.from({ length: 150 }, (_, i) => ({
    id: 1000 + i,
    name: `Archived fixture ${i}`,
    description: "Fixture",
    archived: true,
  }));
  state.collections[145].name = COLLECTION_NAME;
  await assert.rejects(provision(config(), { api }), /collision/);
  assert.equal(
    state.requests.some((r) => r.path.includes("offset=100")),
    true,
  );
  assert.equal(
    state.requests.some((r) => r.path === "/collection?archived=true"),
    false,
  );
  assert.equal(
    state.requests.some((r) => r.method !== "GET"),
    false,
  );
});

test("archived search fails closed for asynchronous engine or incomplete inventory", async () => {
  await assert.rejects(
    archivedCollections(async () => ({
      data: [],
      total: 0,
      offset: 0,
      limit: 100,
      engine: "search.engine/fulltext",
    })),
    /ownership not verified/,
  );
  await assert.rejects(
    archivedCollections(async () => ({
      data: [],
      total: 1,
      offset: 0,
      limit: 100,
      engine: "search.engine/appdb",
    })),
    /incomplete/,
  );
});

test("active and archived AppDB inventories remain separate and validate actual archive flags", async () => {
  const { state, api } = fixture();
  state.collections = [
    { id: 70, name: "Active", description: "Fixture", archived: false },
    { id: 71, name: "Archived", description: "Fixture", archived: true },
  ];
  assert.deepEqual(
    (await activeCollections(api)).map((x) => x.id),
    [70],
  );
  assert.deepEqual(
    (await archivedCollections(api)).map((x) => x.id),
    [71],
  );
  await assert.rejects(
    activeCollections(async () => ({
      data: [{ id: 71, model: "collection", archived: true }],
      total: 1,
      offset: 0,
      limit: 100,
      engine: "search.engine/appdb",
    })),
    /ownership not verified/,
  );
});

test("database graph denies direct dataset queries to nonadmins and preserves other databases", async () => {
  const { state, api } = fixture();
  await provision(config(), { api });
  const databaseId = state.databases[0].id;
  assert.equal(state.dataGroups[1][databaseId]["create-queries"], "no");
  assert.equal(state.dataGroups[9][databaseId]["create-queries"], "no");
  assert.equal(state.dataGroups[1][databaseId].details, "no");
  assert.equal(
    state.dataGroups[2][databaseId]["create-queries"],
    "query-builder-and-native",
  );
  assert.equal(
    state.dataGroups[1][777]["create-queries"],
    "query-builder-and-native",
  );
  assert.equal(state.dataGroups[1][databaseId]["view-data"], "unrestricted");
  const queryIndex = state.requests.findIndex((r) => r.path === "/dataset");
  const restrictionIndex = state.requests.findIndex(
    (r) => r.path === "/permissions/graph" && r.method === "PUT",
  );
  assert.ok(restrictionIndex < queryIndex);
});

test("ineffective database permissions fail before creating dashboard content", async () => {
  const { state, api } = fixture();
  await assert.rejects(
    provision(config(), {
      api: async (...args) => {
        if (args[0] === "PUT" && args[1] === "/permissions/graph")
          return { ignored: true };
        return api(...args);
      },
    }),
    /did not become private/,
  );
  assert.equal(state.cards.length, 0);
  assert.equal(
    state.requests.some((r) => r.path === "/dataset"),
    false,
  );
});

test("pinned API elision of denied query/detail/transform keys is accepted", async () => {
  const { state, api } = fixture();
  await provision(config(), {
    api: async (...args) => {
      const result = await api(...args);
      if (args[0] === "PUT" && args[1] === "/permissions/graph") {
        for (const groupId of [1, 9]) {
          const access = state.dataGroups[groupId][state.databases[0].id];
          delete access["create-queries"];
          delete access.details;
          delete access.transforms;
        }
        // A fully denied group/database object can be pruned too.
        delete state.dataGroups[9][state.databases[0].id];
      }
      return result;
    },
  });
  assert.equal(state.cards.length, CARD_DEFINITIONS.length);
});

test("effective permission checks reject stronger grants, granular query grants and explicit null", async () => {
  for (const permission of [
    { "create-queries": "query-builder" },
    { "create-queries": "query-builder-and-native" },
    { "create-queries": { reporting: "query-builder" } },
    { "create-queries": null },
    { details: "yes" },
    { transforms: "yes" },
  ]) {
    const { state, api } = fixture();
    await assert.rejects(
      provision(config(), {
        api: async (...args) => {
          const result = await api(...args);
          if (args[0] === "PUT" && args[1] === "/permissions/graph")
            Object.assign(
              state.dataGroups[1][state.databases[0].id],
              permission,
            );
          return result;
        },
      }),
      /did not become private/,
    );
    assert.equal(state.cards.length, 0);
    assert.equal(
      state.requests.some((r) => r.path === "/dataset"),
      false,
    );
  }
});

test("wrong version or public-sharing mode stops before mutation", async () => {
  const { state, api } = fixture();
  state.version = "v0.64.0";
  await assert.rejects(provision(config(), { api }), /pinned/);
  assert.equal(state.requests.length, 1);
  const wrapper = async (...args) =>
    args[1] === "/session/properties"
      ? { version: { tag: METABASE_VERSION }, "enable-public-sharing": true }
      : api(...args);
  await assert.rejects(provision(config(), { api: wrapper }), /sharing/);
});

test("existing mismatched database cannot silently reconnect to application data", async () => {
  const { state, api } = fixture();
  state.databases.push({
    id: 99,
    name: DATABASE_NAME,
    engine: "postgres",
    details: { ...config().details, dbname: "postgres" },
  });
  await assert.rejects(provision(config(), { api }), /different connection/);
  assert.equal(
    state.requests.some((r) => r.method !== "GET"),
    false,
  );
});

test("aggregate reader with excess table access is rejected before content is created", async () => {
  const { state, api } = fixture();
  state.unsafe = 1;
  await assert.rejects(
    provision(config(), { api }),
    /restricted aggregate reader/,
  );
  assert.equal(state.cards.length, 0);
  assert.equal(state.collections.length, 0);
});

test("lost mutation response can recover by re-enumerating managed content without duplicates", async () => {
  const { state, api } = fixture();
  let lost = false;
  await assert.rejects(
    provision(config(), {
      api: async (...args) => {
        const result = await api(...args);
        if (!lost && args[0] === "POST" && args[1] === "/card") {
          lost = true;
          throw new Error("Lost response");
        }
        return result;
      },
    }),
    /Lost response/,
  );
  assert.equal(state.cards.length, 1);
  await provision(config(), { api });
  assert.equal(state.cards.length, CARD_DEFINITIONS.length);
});

test("unmanaged dashboard additions and public card links stop subsequent writes", async () => {
  for (const kind of ["unmanaged", "public"]) {
    const { state, api } = fixture();
    await provision(config(), { api });
    if (kind === "unmanaged")
      state.dashboards[0].dashcards.push({ id: 900, card_id: 999 });
    else state.cards[0].public_uuid = "fixture-public-link";
    state.requests.length = 0;
    await assert.rejects(
      provision(config(), { api }),
      kind === "unmanaged" ? /unmanaged/ : /shared or embedded/,
    );
    assert.equal(
      state.requests.some((r) => r.method !== "GET"),
      false,
    );
  }
});

test("definitions enforce bounded UTC filters, unavailable-store semantics and qualified observed return", () => {
  for (const card of CARD_DEFINITIONS) {
    assert.match(card.sql, /\{\{days\}\} BETWEEN 1 AND 30/);
    assert.match(card.sql, /trunc\(\{\{days\}\}::numeric\)/);
    assert.match(
      card.sql,
      /\{\{environment\}\} IN \('dev','prod','synthetic'\)/,
    );
    assert.doesNotMatch(
      card.sql,
      /auth\.users|product_analytics_events|generate_series/i,
    );
    if (card.id !== "coverage") assert.match(card.sql, /AT TIME ZONE 'UTC'/);
  }
  const attempts = CARD_DEFINITIONS.find((x) => x.id === "attempts");
  assert.match(attempts.note, /never inferred abandonment/);
  assert.match(attempts.sql, /nullif/);
  assert.doesNotMatch(
    CARD_DEFINITIONS.find((x) => x.id === "stores").sql,
    /coalesce/i,
  );
  const retention = CARD_DEFINITIONS.find((x) => x.id === "retention");
  assert.match(retention.note, /not signup cohorts/);
  assert.match(retention.note, /matured/);
  assert.match(retention.sql, /nullif/);
  assert.match(
    CARD_DEFINITIONS.find((x) => x.id === "stores").sql,
    /p.environment = 'prod'/,
  );
  assert.match(
    CARD_DEFINITIONS.find((x) => x.id === "flows").note,
    /not a matched funnel or abandonment rate/,
  );
});

test("banner makes the local simulation explicit and keeps unknown outcomes distinct", () => {
  assert.match(SECURITY_TEXT, /Synthetic = simulated demo data/);
  assert.match(SECURITY_TEXT, /unknown is not abandonment/);
  assert.match(
    SECURITY_TEXT,
    /Dev and Production are unavailable until connected/,
  );
});

test("real dashboard defaults and repeat provisioning never select simulated data", async () => {
  const { state, api } = fixture();
  const first = await provision(config(), { api, defaultEnvironment: "prod" });
  const dashboard = state.dashboards[0];
  assert.equal(dashboard.parameters[0].default, "prod");
  assert.deepEqual(dashboard.parameters[0].values_source_config.values, [
    "dev",
    "prod",
  ]);
  assert.equal(
    dashboard.dashcards[0].visualization_settings.text,
    LIVE_SECURITY_TEXT,
  );
  for (const card of state.cards)
    assert.equal(
      card.dataset_query.native["template-tags"].environment.default,
      "prod",
    );
  assert.deepEqual(
    await provision(config(), { api, defaultEnvironment: "prod" }),
    first,
  );
  await provision(config(), { api, defaultEnvironment: "dev" });
  assert.equal(dashboard.parameters[0].default, "dev");
  assert.equal(state.dashboards.length, 1);
});
test("invalid default environment refuses all API calls", async () => {
  const { state, api } = fixture();
  await assert.rejects(
    provision(config(), { api, defaultEnvironment: "unknown" }),
    /Invalid dashboard default/,
  );
  assert.equal(state.requests.length, 0);
});
