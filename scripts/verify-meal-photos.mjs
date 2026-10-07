// Coordinator-only synthetic local/Dev probe. No provider calls or secret output.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const fixturePath = process.env.MEAL_PHOTO_PROBE_CONFIG;
const fixtureInfo = statSync(fixturePath);
if ((fixtureInfo.mode & 0o077) !== 0)
  throw new Error("Private probe configuration required");
const config = JSON.parse(readFileSync(fixturePath, "utf8"));
const local = config.MODE === "local";
if (
  !(
    local &&
    config.API_URL === "http://127.0.0.1:54721" &&
    config.DISPOSABLE === true
  ) &&
  !(
    config.MODE === "dev" &&
    config.API_URL === "http://127.0.0.1:8100" &&
    config.HTTP_API === "https://mizyun-api-dev.phiskel.com"
  )
)
  throw new Error(
    "Probe restricted to explicit disposable local or canonical Dev targets",
  );
const requireAdapter = createRequire(
  new URL("../packages/adapters/supabase-server/package.json", import.meta.url),
);
const { createClient } = requireAdapter("@supabase/supabase-js");
const sharp = requireAdapter("sharp");
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let app = null;
if (local) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    API_PORT: "4100",
    SUPABASE_URL: config.API_URL,
    SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
    SUPABASE_PUBLIC_URL: config.API_URL,
    MIZYUN_ENVIRONMENT: "dev",
    MEAL_PHOTOS_ENABLED: "true",
    AGENT_PROVIDER: "disabled",
    VISION_PROVIDER: "disabled",
    AI_EXTERNAL_ACCESS: "false",
  });
  const { buildApp } = await import("../apps/api/src/app.ts");
  app = buildApp();
  await app.ready();
}
let assertions = 0;
function check(label, value) {
  if (!value) throw new Error(label);
  assertions++;
}
async function request(token, method, path, body) {
  const headers = {
    authorization: `Bearer ${token}`,
    ...(body ? { "content-type": "application/json" } : {}),
  };
  if (app) {
    const response = await app.inject({
      method,
      url: path,
      headers,
      ...(body ? { payload: body } : {}),
    });
    return {
      status: response.statusCode,
      body: response.body ? response.json() : null,
    };
  }
  const response = await fetch(config.HTTP_API + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}
const users = [];
const password = randomUUID() + "Aa9!";
async function person() {
  const email = `meal-photo-probe-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  check("Synthetic Auth user created", !created.error && created.data.user);
  const id = created.data.user.id;
  users.push(id);
  const client = createClient(config.API_URL, config.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  check("Real Auth session created", !login.error && login.data.session);
  const token = login.data.session.access_token;
  return { id, client, token };
}
async function meal(person) {
  const response = await request(person.token, "POST", "/v1/food-entries", {
    clientOperationId: randomUUID(),
    name: "Synthetic photo verification meal",
    consumedAt: new Date().toISOString(),
    caloriesKcal: 100,
  });
  check(
    `Real API meal created (status${response.status},code${response.body?.error?.code ?? "none"})`,
    [200, 201].includes(response.status) && response.body.foodEntry?.id,
  );
  return response.body.foodEntry.id;
}
async function absent(path) {
  const result = await admin.storage.from("private-media").download(path);
  if (!result.error) return false;
  const error = result.error;
  if (
    String(error.statusCode) === "404" ||
    (error.name === "StorageApiError" && error.message === "Object not found")
  )
    return true;
  throw new Error("Storage download failed without proving object absence");
}
async function waitAbsent(path) {
  const deadline = Date.now() + 70000;
  do {
    if (await absent(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  return false;
}
try {
  const a = await person(),
    b = await person();
  const mealId = await meal(a),
    path = `/v1/food-entries/${mealId}/photo`;
  const bytes = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#669955" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "synthetic-metadata-to-strip" } } })
    .jpeg()
    .toBuffer();
  const payload = {
    clientOperationId: randomUUID(),
    imageBase64: bytes.toString("base64"),
    mimeType: "image/jpeg",
    width: 120,
    height: 80,
  };
  check(
    "Foreign meal photo save denied",
    (await request(b.token, "POST", path, payload)).status === 404,
  );
  check(
    "Invalid JPEG rejected",
    (
      await request(a.token, "POST", path, {
        ...payload,
        imageBase64: Buffer.from("invalid").toString("base64"),
      })
    ).status === 422,
  );
  check(
    "Claimed dimensions validated",
    (await request(a.token, "POST", path, { ...payload, width: 119 }))
      .status === 422,
  );
  const saved = await request(a.token, "POST", path, payload);
  check(
    "Photo stored by real API",
    [200, 201].includes(saved.status) && saved.body.photo?.assetId,
  );
  const assetId = saved.body.photo.assetId;
  const repeated = await request(a.token, "POST", path, payload);
  check(
    "Lost-response retry keeps one asset",
    [200, 201].includes(repeated.status) &&
      repeated.body.photo?.assetId === assetId,
  );
  const read = await request(a.token, "GET", path);
  check(
    "Owner receives signed photo",
    read.status === 200 && read.body.photo?.signedUrl,
  );
  const signed = new URL(read.body.photo.signedUrl);
  check(
    "Signed URL remains in target environment",
    signed.origin ===
      new URL(config.PUBLIC_SUPABASE_URL ?? config.API_URL).origin,
  );
  const download = await fetch(signed, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  check("Signed private image downloads", download.status === 200);
  const metadata = await sharp(
    Buffer.from(await download.arrayBuffer()),
  ).metadata();
  check(
    "Trusted dimensions and metadata stripping",
    metadata.width === 120 &&
      metadata.height === 80 &&
      !metadata.exif &&
      !metadata.xmp &&
      !metadata.iptc,
  );
  check(
    "Foreign photo read denied",
    (await request(b.token, "GET", path)).status === 404,
  );
  check(
    "Foreign photo removal denied",
    (await request(b.token, "DELETE", path)).status === 404,
  );
  const direct = await a.client.rpc("meal_photo", {
    p_operation: "begin",
    p_args: {
      mealId,
      operationId: randomUUID(),
      width: 640,
      height: 640,
      byteSize: 1,
    },
    p_user_id: a.id,
  });
  check("Authenticated direct mutation bypass denied", !!direct.error);
  const asset = await a.client
    .from("media_assets")
    .select("object_path")
    .eq("id", assetId)
    .single();
  check(
    `Retained asset is registered (code${asset.error?.code ?? "none"})`,
    !asset.error && asset.data?.object_path,
  );
  const objectPath = asset.data.object_path;
  const overwrite = await a.client.storage
    .from("private-media")
    .upload(objectPath, bytes, { upsert: true, contentType: "image/jpeg" });
  check("Authenticated storage overwrite bypass denied", !!overwrite.error);
  const exported = await request(
    a.token,
    "GET",
    "/v1/account/export?catalog=dashboard-v1",
  );
  check(
    "Account export includes retained asset",
    exported.status === 200 &&
      exported.body.export?.privateMedia?.some((entry) => entry.id === assetId),
  );
  check(
    "Account export preserves meal photo association",
    exported.body.export?.foodEntries?.some(
      (entry) => entry.id === mealId && entry.photoAssetId === assetId,
    ),
  );
  check(
    "Owner photo removal succeeds",
    (await request(a.token, "DELETE", path)).status === 204,
  );
  check(
    "Removal retry succeeds",
    (await request(a.token, "DELETE", path)).status === 204,
  );
  check(
    "Photo removal preserves meal",
    (await request(a.token, "GET", `/v1/food-entries/${mealId}`)).status ===
      200,
  );
  check("Photo removal erases bytes", await waitAbsent(objectPath));
  const savedAgain = await request(a.token, "POST", path, {
    ...payload,
    clientOperationId: randomUUID(),
  });
  check(
    "New photo after removal succeeds",
    [200, 201].includes(savedAgain.status),
  );
  const secondAsset = await a.client
    .from("media_assets")
    .select("object_path")
    .eq("id", savedAgain.body.photo.assetId)
    .single();
  check(
    "Meal deletion succeeds",
    (await request(a.token, "DELETE", `/v1/food-entries/${mealId}`)).status ===
      204,
  );
  check(
    "Meal deletion erases photo bytes",
    await waitAbsent(secondAsset.data.object_path),
  );
  const accountMeal = await meal(a);
  const accountPhoto = await request(
    a.token,
    "POST",
    `/v1/food-entries/${accountMeal}/photo`,
    { ...payload, clientOperationId: randomUUID() },
  );
  check(
    "Account cascade fixture saved",
    [200, 201].includes(accountPhoto.status),
  );
  const accountAsset = await a.client
    .from("media_assets")
    .select("object_path")
    .eq("id", accountPhoto.body.photo.assetId)
    .single();
  const deleted = await admin.auth.admin.deleteUser(a.id);
  check("Synthetic Auth account deletion succeeds", !deleted.error);
  users.splice(users.indexOf(a.id), 1);
  check(
    "Account cascade erases photo bytes",
    await waitAbsent(accountAsset.data.object_path),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      assertions,
      mode: config.MODE,
      syntheticOnly: true,
      providerCalls: 0,
    }),
  );
} finally {
  for (const id of users) {
    const removed = await admin.auth.admin.deleteUser(id);
    check("Synthetic account cleanup succeeds", !removed.error);
  }
  if (app) await app.close();
}
