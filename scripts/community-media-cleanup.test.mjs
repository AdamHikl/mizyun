import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommunityMediaCleaner } from "./community-media-cleanup.mjs";
import { runCommunityTick } from "./community-worker.mjs";
const id = "71000000-0000-4000-8000-000000000001";
const job = {
  id,
  imagePath: `quarantine/${id}/image.jpg`,
  thumbnailPath: `quarantine/${id}/thumbnail.jpg`,
};
test("lost Storage response leaves durable ticket; retry removes exact two derived paths then acknowledges", async () => {
  let acknowledged = 0;
  let calls = 0;
  const rpc = async (name, args) =>
    args.p_operation === "claim" ? [job] : acknowledged++;
  const cleaner = createCommunityMediaCleaner({
    rpc,
    url: "https://mizyun-supabase-dev.phiskel.com",
    key: "test-only",
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/storage/v1/object/community-media");
      assert.deepEqual(JSON.parse(options.body).prefixes, [
        job.imagePath,
        job.thumbnailPath,
      ]);
      if (calls++ === 0) throw new Error("lost response");
      return { ok: true };
    },
  });
  await assert.rejects(cleaner(), /lost response/);
  assert.equal(acknowledged, 0);
  assert.equal(await cleaner(), 1);
  assert.equal(acknowledged, 1);
});
test("forged private-media paths never reach Storage", async () => {
  let fetches = 0;
  const cleaner = createCommunityMediaCleaner({
    rpc: async () => [{ ...job, imagePath: "../private-media/health.jpg" }],
    url: "https://mizyun-supabase-dev.phiskel.com",
    key: "test-only",
    fetchImpl: async () => {
      fetches++;
      return { ok: true };
    },
  });
  await assert.rejects(cleaner(), /Invalid media cleanup path/);
  assert.equal(fetches, 0);
});
test("byte privacy cleanup runs with all delivery disabled", async () => {
  let cleaned = 0;
  await runCommunityTick({
    rpc: async (name) => (name === "community_withdrawal_pending" ? [] : []),
    cleanupMedia: async () => cleaned++,
    deliveryEnabled: false,
  });
  assert.equal(cleaned, 1);
});
