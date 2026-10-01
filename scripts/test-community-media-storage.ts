/** Real private Storage + real Sharp + server-issued MFA on disposable loopback.
 * Invoked by test-community-expansion-postgrest.py using an owner-only fixture
 * file. No credentials in argv/output. Every network URL/redirect is checked.
 * Coordinator, never helper agents, executes against isolated current schema.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  SupabaseCommunityMediaService,
  createSupabaseCommunityMediaStorage,
  createSupabaseRepositoryClient,
  createSupabaseServiceRoleClient,
} from "../packages/adapters/supabase-server/src/index.js";

const requireAdapter = createRequire(
  new URL("../packages/adapters/supabase-server/package.json", import.meta.url),
);
const sharp: typeof import("../packages/adapters/supabase-server/node_modules/sharp").default =
  requireAdapter("sharp");
type Person = { id: string; token: string };
type Config = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  USERS: Person[];
  STAFF_TOKEN: string;
  DISPOSABLE_LOCAL_STACK: boolean;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let assertions = 0;
let stage = "private configuration";
let lastCheck = "start";
let lastHttp = "none";
let lastStatus = 0;
function check(label: string, condition: unknown): asserts condition {
  lastCheck = label;
  if (!condition) throw new Error(label);
  assertions++;
}
async function denied(label: string, operation: () => Promise<unknown>) {
  let failed = false;
  try {
    await operation();
  } catch (error) {
    // Network faults do not prove authorization denial. Require domain ACL error.
    failed =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["unavailable", "access_denied"].includes(String(error.code));
  }
  check(label, failed);
}
function configFromFile(): Config {
  const index = process.argv.indexOf("--config");
  const path = process.argv[index + 1];
  check("Private fixture config required", index > 0 && !!path);
  const info = statSync(path);
  check(
    "Owner-only fixture config required",
    (info.mode & 0o077) === 0 && info.uid === process.getuid?.(),
  );
  const config: Config = JSON.parse(readFileSync(path, "utf8"));
  const api = new URL(config.API_URL);
  const db = new URL(config.DB_URL);
  const loopback = (hostname: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  check(
    "Explicit disposable loopback attestation required",
    config.DISPOSABLE_LOCAL_STACK === true &&
      api.protocol === "http:" &&
      loopback(api.hostname) &&
      !!api.port &&
      !api.username &&
      !api.password &&
      !api.search &&
      !api.hash &&
      ["", "/"].includes(api.pathname) &&
      ["postgres:", "postgresql:"].includes(db.protocol) &&
      loopback(db.hostname) &&
      !!db.port &&
      !db.search &&
      !db.hash &&
      /^\/mizyun_community_[a-z0-9_]{1,45}$/.test(db.pathname),
  );
  check(
    "Distinct local keys and four fixture principals required",
    !!config.ANON_KEY &&
      !!config.SERVICE_ROLE_KEY &&
      config.ANON_KEY !== config.SERVICE_ROLE_KEY &&
      config.USERS.length === 4 &&
      config.USERS.every(
        (p) =>
          uuid.test(p.id) && typeof p.token === "string" && p.token.length > 20,
      ) &&
      new Set(config.USERS.map((p) => p.id)).size === 4,
  );
  const staff = JSON.parse(
    Buffer.from(config.STAFF_TOKEN.split(".")[1]!, "base64url").toString(),
  );
  check(
    "Server-issued named aal2 fixture required",
    staff.aal === "aal2" && staff.sub === config.USERS[3]!.id,
  );
  return config;
}
async function main() {
  const config = configFromFile();
  const base = new URL(config.API_URL);
  const originalFetch = globalThis.fetch;
  // Supabase SDK, adapters and fixture calls all pass through this origin guard.
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    check(
      "Refuse external or unexpected media request",
      url.origin === base.origin &&
        /^\/(auth|rest|storage)\/v1\//.test(url.pathname) &&
        !url.username &&
        !url.password,
    );
    lastHttp = url.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi, "fixture");
    const response = await originalFetch(input, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    lastStatus = response.status;
    check(
      "Refuse redirected credential-bearing request",
      response.status < 300 || response.status >= 400,
    );
    return response;
  };
  const headers = (token: string, service = false) => ({
    apikey: service ? config.SERVICE_ROLE_KEY : config.ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  });
  async function request(
    method: string,
    path: string,
    token: string,
    body?: unknown,
    service = false,
  ) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: headers(token, service),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let data: unknown = null;
    try {
      if (raw) data = JSON.parse(raw);
    } catch {
      /* No raw body diagnostics. */
    }
    return { status: response.status, data };
  }
  async function fixture(method: string, path: string, body?: unknown) {
    const result = await request(
      method,
      path,
      config.SERVICE_ROLE_KEY,
      body,
      true,
    );
    check(
      "Synthetic service fixture mutation",
      [200, 201, 204].includes(result.status),
    );
    return result.data as Record<string, unknown>[];
  }
  const admin = await request(
    "GET",
    "/auth/v1/admin/users?page=1&per_page=10",
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  const adminUsers = (admin.data as { users: Person[] })?.users;
  check(
    "Exactly supplied synthetic Auth cohort required",
    admin.status === 200 &&
      adminUsers?.length === 4 &&
      adminUsers.every((p) => config.USERS.some((s) => s.id === p.id)),
  );
  const initial = await request(
    "GET",
    "/rest/v1/community_media_assets?select=id&limit=1",
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Empty disposable media precondition",
    initial.status === 200 &&
      Array.isArray(initial.data) &&
      initial.data.length === 0,
  );
  const initialJobs = await request(
    "GET",
    "/rest/v1/community_media_cleanup_jobs?select=id&limit=1",
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Empty disposable physical cleanup precondition",
    initialJobs.status === 200 &&
      Array.isArray(initialJobs.data) &&
      initialJobs.data.length === 0,
  );
  const [author, follower, erased, staffPerson] = config.USERS as [
    Person,
    Person,
    Person,
    Person,
  ];
  const repositoryConfig = {
    url: config.API_URL,
    publishableKey: config.ANON_KEY,
  };
  const storage = createSupabaseCommunityMediaStorage({
    url: config.API_URL,
    serviceRoleKey: config.SERVICE_ROLE_KEY,
  });
  const media = new SupabaseCommunityMediaService({
    clientFor: (token) =>
      createSupabaseRepositoryClient(repositoryConfig, token),
    serviceClient: createSupabaseServiceRoleClient({
      ...repositoryConfig,
      serviceRoleKey: config.SERVICE_ROLE_KEY,
    }),
    storage,
  });
  async function report(id: string, receiptId?: string) {
    const client = createSupabaseRepositoryClient(
      repositoryConfig,
      follower.token,
    );
    let receipt = receiptId;
    if (!receipt) {
      const issued = await client.rpc("community_issue_report_receipt", {
        p_target_type: "media",
        p_target_id: id,
      });
      check(
        "Real visible-image evidence receipt",
        !issued.error && Array.isArray(issued.data) && issued.data.length === 1,
      );
      receipt = (issued.data[0] as { id: string }).id;
    }
    const created = await client.rpc("community_submit_report", {
      p_target_type: "media",
      p_target_id: id,
      p_reason: "spam",
      p_notes: "Synthetic case evidence acceptance",
      p_interaction_receipt_id: receipt,
    });
    check(
      "Real image report sanitizes viewer evidence",
      !created.error &&
        Array.isArray(created.data) &&
        created.data.length === 1 &&
        (created.data[0] as { subject_user_id: unknown }).subject_user_id ===
          null,
    );
    return { id: (created.data[0] as { id: string }).id, receiptId: receipt };
  }
  const original = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#998844" },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: "PRIVATE SYNTHETIC OWNER" },
      IFD3: { GPSLatitude: "51/1 0/1 0/1", GPSLongitude: "15/1 0/1 0/1" },
    })
    .toBuffer();
  async function upload(person: Person) {
    const input = {
      userId: person.id as Parameters<typeof media.upload>[0]["userId"],
      accessToken: person.token,
      operationId: randomUUID(),
      altText: "Synthetic colored rectangle",
      mimeType: "image/jpeg" as const,
      bytes: original,
    };
    stage = "sanitized upload ticket and immutable storage writes";
    const asset = (await media.upload(input)) as { id: string; state: string };
    check(
      "Real sanitized upload enters quarantine",
      uuid.test(asset.id) && asset.state === "pending",
    );
    stage = "lost upload response replay";
    check(
      "Lost upload response reuses exact asset",
      ((await media.upload(input)) as { id: string }).id === asset.id,
    );
    return asset;
  }
  stage = "real sanitized upload and private Storage";
  const first = await upload(author);
  const path = `quarantine/${first.id}/image.jpg`;
  stage = "sanitized bytes download";
  const sanitized = await storage.get(path);
  stage = "sanitized stored metadata";
  const metadata = await sharp(sanitized).metadata();
  check(
    "Storage holds decoded bounded metadata-free JPEG",
    metadata.format === "jpeg" &&
      metadata.width === 1600 &&
      metadata.height === 800 &&
      !metadata.exif &&
      !metadata.icc &&
      !metadata.xmp &&
      sanitized.length < 2 * 1024 * 1024,
  );
  for (const person of [author, follower, erased]) {
    const direct = await request(
      "GET",
      `/storage/v1/object/authenticated/community-media/${path}`,
      person.token,
    );
    check(
      "Direct user Storage route denies private bytes",
      direct.status >= 400 && direct.status < 500,
    );
  }
  const anonymous = await request(
    "GET",
    `/storage/v1/object/public/community-media/${path}`,
    config.ANON_KEY,
  );
  check(
    "Anonymous public Storage route denies bytes",
    anonymous.status >= 400 && anonymous.status < 500,
  );
  await denied("Pending follower proxy denied", () =>
    media.content(first.id, "image", follower.token),
  );
  await denied("Pending unrelated proxy denied", () =>
    media.content(first.id, "image", erased.token),
  );
  const anonymousRpc = await request(
    "POST",
    "/rest/v1/rpc/community_media_access",
    config.ANON_KEY,
    { p_id: first.id, p_variant: "image" },
  );
  check(
    "Anonymous cannot execute the protected media authorization RPC",
    [401, 403].includes(anonymousRpc.status),
  );
  await denied("Staff registry without real MFA denied", () =>
    media.execute("queue", {}, staffPerson.token),
  );
  stage = "real named MFA review and approval";
  const pendingPixels = await media.content(
    first.id,
    "thumbnail",
    config.STAFF_TOKEN,
  );
  check(
    "Named real MFA staff can inspect quarantine bytes",
    (await sharp(pendingPixels).metadata()).width === 320,
  );
  const audit = await request(
    "GET",
    `/rest/v1/community_moderation_actions?target_type=eq.media&target_id=eq.${first.id}&action=eq.inspect`,
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Pending pixel inspections have durable audit",
    audit.status === 200 && Array.isArray(audit.data) && audit.data.length >= 2,
  );
  await media.execute(
    "review",
    {
      id: first.id,
      decision: "approve",
      reason: "Synthetic independently reviewed still",
    },
    config.STAFF_TOKEN,
  );
  const visible = await media.content(first.id, "image", follower.token);
  check(
    "Approved current follower proxy delivers exact sanitized JPEG",
    Buffer.from(visible).equals(Buffer.from(sanitized)),
  );
  await denied("Unrelated approved image denied", () =>
    media.content(first.id, "image", erased.token),
  );
  await denied("Unrelated named staff approved image denied", () =>
    media.content(first.id, "image", config.STAFF_TOKEN),
  );
  const firstCase = await report(first.id);
  check(
    "Unrelated staff gains only case-scoped evidence",
    Buffer.from(
      await media.evidence(firstCase.id, "image", config.STAFF_TOKEN),
    ).equals(Buffer.from(sanitized)),
  );
  await denied("Ordinary reporter cannot inspect staff pixels", () =>
    media.evidence(firstCase.id, "image", follower.token),
  );
  stage = "block, explicit revoke and Auth erasure";
  let result = await request(
    "POST",
    "/rest/v1/community_blocks",
    follower.token,
    { blocker_user_id: follower.id, blocked_user_id: author.id },
  );
  check("Real follower establishes bilateral block", result.status === 201);
  await denied("Block revokes real approved proxy", () =>
    media.content(first.id, "image", follower.token),
  );
  await fixture(
    "DELETE",
    `/rest/v1/community_blocks?blocker_user_id=eq.${follower.id}&blocked_user_id=eq.${author.id}`,
  );
  await denied("Unblock does not restore removed relationship", () =>
    media.content(first.id, "image", follower.token),
  );
  await fixture("POST", "/rest/v1/community_relationships", [
    {
      follower_user_id: follower.id,
      target_user_id: author.id,
      status: "approved",
    },
    {
      follower_user_id: author.id,
      target_user_id: follower.id,
      status: "approved",
    },
  ]);
  await media.execute("delete", { id: first.id }, author.token);
  await denied("Explicit revoke denies approved pixels", () =>
    media.content(first.id, "image", follower.token),
  );
  const second = await upload(erased);
  await media.execute(
    "review",
    {
      id: second.id,
      decision: "approve",
      reason: "Synthetic independent review before erasure",
    },
    config.STAFF_TOKEN,
  );
  check(
    "Second follower gets real bytes before Auth erasure",
    (await media.content(second.id, "thumbnail", follower.token)).length > 0,
  );
  const erasedCase = await report(second.id);
  check(
    "Real case pixels exist before synthetic Auth erasure",
    (await media.evidence(erasedCase.id, "thumbnail", config.STAFF_TOKEN))
      .length > 0,
  );
  result = await request(
    "DELETE",
    `/auth/v1/admin/users/${erased.id}`,
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Real synthetic Auth erasure succeeds",
    [200, 204].includes(result.status),
  );
  await denied("Auth erasure denies former follower pixels", () =>
    media.content(second.id, "thumbnail", follower.token),
  );
  await denied("Auth erasure denies original case pixels", () =>
    media.evidence(erasedCase.id, "thumbnail", config.STAFF_TOKEN),
  );
  const lateCase = await report(second.id, erasedCase.receiptId);
  await denied("Fresh erased-subject case cannot revive pixels", () =>
    media.evidence(lateCase.id, "thumbnail", config.STAFF_TOKEN),
  );
  const jobs = await request(
    "GET",
    `/rest/v1/community_media_cleanup_jobs?id=in.(${first.id},${second.id})`,
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Auth cascade preserves durable physical cleanup jobs",
    jobs.status === 200 && Array.isArray(jobs.data) && jobs.data.length === 2,
  );
  // Only synthetic tickets become due. No shared/global maintenance mutation.
  stage = "physical Storage cleanup and durable ACK";
  await fixture(
    "PATCH",
    `/rest/v1/community_media_cleanup_jobs?id=in.(${first.id},${second.id})`,
    { not_before: new Date(Date.now() - 1000).toISOString() },
  );
  check(
    "Actual adapter removes both derived objects before ACK",
    (await media.cleanup(2)) === 2,
  );
  const remaining = await request(
    "GET",
    `/rest/v1/community_media_cleanup_jobs?id=in.(${first.id},${second.id})`,
    config.SERVICE_ROLE_KEY,
    undefined,
    true,
  );
  check(
    "Physical cleanup ACK removes durable tickets",
    remaining.status === 200 &&
      Array.isArray(remaining.data) &&
      remaining.data.length === 0,
  );
  for (const id of [first.id, second.id])
    for (const variant of ["image", "thumbnail"]) {
      const missing = await request(
        "GET",
        `/storage/v1/object/authenticated/community-media/quarantine/${id}/${variant}.jpg`,
        config.SERVICE_ROLE_KEY,
        undefined,
        true,
      );
      const details = missing.data as {
        error?: string;
        message?: string;
        statusCode?: string;
      } | null;
      check(
        "Derived private object is physically absent after ACK",
        missing.status === 404 ||
          (missing.status === 400 &&
            (details?.error === "not_found" ||
              details?.statusCode === "404" ||
              details?.message === "Object not found")),
      );
    }
  console.log(`Community media real Storage assertions passed: ${assertions}`);
}
main().catch((error: unknown) => {
  const name =
    error instanceof Error && /^[A-Za-z]+$/.test(error.name)
      ? error.name
      : "UnknownError";
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^[a-z_]{1,40}$/.test(String(error.code))
      ? String(error.code)
      : "unspecified";
  console.error(
    `Community media real Storage acceptance failed at ${stage}; last check ${lastCheck}; category ${name}/${code}; HTTP ${lastStatus} ${lastHttp}`,
  );
  process.exitCode = 1;
});
