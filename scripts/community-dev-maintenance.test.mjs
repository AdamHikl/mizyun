import { test } from "node:test";
import assert from "node:assert/strict";
import { runDevCommunityMaintenance } from "./community-dev-maintenance.mjs";

const target = {
  hostRole: "hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3",
  env: {
    SUPABASE_URL: "http://127.0.0.1:8100",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    MIZYUN_API_SERVICE: "mizyun-api-dev.service",
    MIZYUN_LOCAL_API_URL: "http://127.0.0.1:4100",
    API_HOST: "127.0.0.1",
    API_PORT: "4100",
    MIZYUN_DEV_DB_URL: "postgresql://test:synthetic@127.0.0.1:5433/postgres",
    COMMUNITY_DELIVERY_ENABLED: "true",
  },
};

test("Dev maintenance finishes withdrawal and retention without claiming or contacting push", async () => {
  const calls = [];
  let batches = 0;
  const stats = await runDevCommunityMaintenance({
    ...target,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.apikey, "synthetic-service-key");
      assert.ok(url.startsWith("http://127.0.0.1:8100/rest/v1/rpc/"));
      const name = url.split("/").at(-1);
      calls.push(name);
      if (name === "community_withdrawal_pending")
        return new Response(
          JSON.stringify([{ user_id: "fixture", generation: 1 }]),
        );
      if (name === "community_withdrawal_batch") {
        assert.deepEqual(JSON.parse(options.body), {
          p_user_id: "fixture",
          p_generation: 1,
          p_limit: 500,
        });
        return new Response(JSON.stringify([{ complete: ++batches === 2 }]));
      }
      assert.ok(
        ["community_retention_batch", "community_media_cleanup"].includes(name),
      );
      return new Response("[]");
    },
  });
  assert.deepEqual(calls, [
    "community_withdrawal_pending",
    "community_withdrawal_batch",
    "community_withdrawal_batch",
    "community_retention_batch",
    "community_media_cleanup",
  ]);
  assert.equal(stats.cleanupBatches, 2);
  assert.equal(stats.claims, 0);
  assert.equal(stats.accepted, 0);
  assert.equal(stats.receipts, 0);
});

test("wrong host, missing secret and every mixed target fail before any network call", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests++;
    throw new Error("Unexpected network request");
  };
  const invalid = [
    { ...target, hostRole: "frozen-pi" },
    ...Object.entries({
      SUPABASE_URL: "http://127.0.0.1:8000",
      SUPABASE_SERVICE_ROLE_KEY: "",
      MIZYUN_API_SERVICE: "mizyun-api.service",
      MIZYUN_LOCAL_API_URL: "http://127.0.0.1:4000",
      API_HOST: "0.0.0.0",
      API_PORT: "4000",
      MIZYUN_DEV_DB_URL: "postgresql://test:synthetic@127.0.0.1:5432/postgres",
    }).map(([key, value]) => ({
      ...target,
      env: { ...target.env, [key]: value },
    })),
    {
      ...target,
      env: {
        ...target.env,
        MIZYUN_DEV_DB_URL: "postgresql://test:synthetic@127.0.0.1/postgres",
      },
    },
  ];
  for (const value of invalid)
    await assert.rejects(
      runDevCommunityMaintenance({ ...value, fetchImpl }),
      /target mismatch/,
    );
  assert.equal(requests, 0);
});

test("failed maintenance or redirect stops before later work and never logs server payloads", async () => {
  let requests = 0;
  await assert.rejects(
    runDevCommunityMaintenance({
      ...target,
      fetchImpl: async (_url, options) => {
        requests++;
        assert.equal(options.redirect, "error");
        return new Response("private response", { status: 302 });
      },
    }),
    /Community worker RPC failed/,
  );
  assert.equal(requests, 1);
});

test("Dev timer removes both immutable media objects before acknowledging, even with delivery off", async () => {
  const id = "12000000-0000-4000-8000-000000000001";
  const calls = [];
  await runDevCommunityMaintenance({
    ...target,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      const path = new URL(String(url)).pathname;
      if (path.startsWith("/storage/")) {
        assert.equal(path, "/storage/v1/object/community-media");
        assert.equal(options.method, "DELETE");
        assert.deepEqual(JSON.parse(options.body), {
          prefixes: [
            `quarantine/${id}/image.jpg`,
            `quarantine/${id}/thumbnail.jpg`,
          ],
        });
        calls.push("storage");
        return new Response("[]");
      }
      const name = path.split("/").at(-1);
      if (name !== "community_media_cleanup") return new Response("[]");
      const args = JSON.parse(options.body);
      calls.push(args.p_operation);
      return new Response(
        JSON.stringify(
          args.p_operation === "claim"
            ? [
                {
                  id,
                  imagePath: `quarantine/${id}/image.jpg`,
                  thumbnailPath: `quarantine/${id}/thumbnail.jpg`,
                },
              ]
            : {},
        ),
      );
    },
  });
  assert.deepEqual(calls, ["claim", "storage", "ack"]);
});
