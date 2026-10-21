import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FACTOR_FRIENDLY_NAME,
  ENVIRONMENTS,
  assertHttps,
  createTtyPrompter,
  parseSessionArgs,
  resolveEnvironment,
  run,
} from "./community-staff-session.mjs";

const PASSWORD = "correct-horse-battery";
const CODE = "123456";
const SUPABASE = "https://mizyun-supabase.phiskel.com";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "ES256" })}.${b64(claims)}.sig`;
const AAL1 = jwt({ aal: "aal1", sub: "u1" });
const AAL2 = jwt({ aal: "aal2", sub: "u1" });
const SECRET = "JBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/Mizyun:me?secret=${SECRET}&issuer=Mizyun`;

const sink = () => {
  const chunks = [];
  return {
    write: (c) => chunks.push(String(c)),
    isTTY: false,
    text: () => chunks.join(""),
  };
};

function makeDeps({
  factors = [],
  answers = [CODE],
  verifyStatus = 200,
  // Fixture env files, so the suite never needs the gitignored real ones.
  config = {
    readFile: (path) =>
      `EXPO_PUBLIC_SUPABASE_URL=https://mizyun-supabase${
        path.endsWith(".env.dev") ? "-dev" : ""
      }.phiskel.com\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\n`,
  },
} = {}) {
  const calls = [];
  const queue = [...answers];
  const stdout = sink();
  const stderr = sink();
  const spawned = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname.replace("/auth/v1", "");
    const method = init.method;
    calls.push({
      method,
      path,
      headers: init.headers,
      body: init.body && JSON.parse(init.body),
    });
    const reply = (status, body) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(body),
    });
    if (path === "/token") {
      return reply(200, { access_token: AAL1, refresh_token: "refresh-x" });
    }
    if (path === "/user") return reply(200, { factors });
    if (method === "DELETE") return reply(200, {});
    if (path === "/factors" && method === "POST")
      return reply(200, {
        id: "new-factor",
        type: "totp",
        totp: { uri: URI, secret: SECRET },
      });
    if (path.endsWith("/challenge")) return reply(200, { id: "challenge-1" });
    if (path.endsWith("/verify"))
      return verifyStatus === 200
        ? reply(200, { access_token: AAL2 })
        : reply(400, {
            error_code: "mfa_verification_failed",
            msg: `Invalid TOTP code ${CODE}`,
          });
    return reply(404, {});
  };
  const prompter = {
    ask: async () => "mod@example.com",
    askHidden: async (q) =>
      /password/i.test(q) ? PASSWORD : (queue.shift() ?? ""),
    close() {},
  };
  const deps = {
    fetch,
    prompter,
    stdout,
    stderr,
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return { status: 0 };
    },
    env: { PATH: "/bin", COMMUNITY_STAFF_ACCESS_TOKEN: "stale" },
    config,
    clearScreen: false,
  };
  return { deps, calls, stdout, stderr, spawned };
}

const all = (h) => h.stdout.text() + h.stderr.text();

describe("community-staff-session", () => {
  it("fails with usage when --env is missing", async () => {
    const h = makeDeps();
    assert.equal(await run([], h.deps), 1);
    assert.match(h.stderr.text(), /--env production\|dev is required/);
    assert.match(h.stderr.text(), /Usage:/);
    assert.equal(h.calls.length, 0);
    assert.throws(
      () => parseSessionArgs(["--env", "staging"]),
      /production or dev/,
    );
  });

  it("never accepts passwords, codes or tokens via argv", async () => {
    for (const flag of [
      "--password",
      "--password=x",
      "--code",
      "--otp",
      "--token",
      "--email",
    ]) {
      assert.throws(
        () => parseSessionArgs(["--env", "dev", flag, "secret"]),
        /never accepted as arguments/,
        flag,
      );
    }
    const h = makeDeps();
    assert.equal(
      await run(["--env", "production", "--password", PASSWORD], h.deps),
      1,
    );
    assert.equal(h.calls.length, 0);
    assert.ok(!all(h).includes(PASSWORD));
    assert.throws(
      () =>
        parseSessionArgs([
          "--env",
          "dev",
          "--",
          "--api-url",
          "https://evil.example",
        ]),
      /Do not pass --api-url/,
    );
  });

  it("refuses non-HTTPS URLs", () => {
    assert.throws(() => assertHttps("http://example.com", "x"), /HTTPS/);
    assert.throws(() => assertHttps("https://u:p@example.com", "x"), /HTTPS/);
    assert.throws(
      () =>
        resolveEnvironment("production", {
          readFile: () =>
            "EXPO_PUBLIC_SUPABASE_URL=http://mizyun-supabase.phiskel.com\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=k\n",
        }),
      /HTTPS/,
    );
    const cfg = resolveEnvironment("production", {
      readFile: () =>
        `EXPO_PUBLIC_SUPABASE_URL="${SUPABASE}"\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pk\n`,
    });
    assert.equal(cfg.supabaseUrl, SUPABASE);
    assert.equal(cfg.apiUrl, "https://mizyun-api.phiskel.com");
  });

  // The mobile env files are gitignored, so a fresh checkout (CI) lacks them.
  for (const env of ["production", "dev"]) {
    const file = fileURLToPath(
      new URL(`../${ENVIRONMENTS[env].envFile}`, import.meta.url),
    );
    it(
      `resolves the real public ${env} env file when present`,
      {
        skip: !existsSync(file) && "gitignored env file absent",
      },
      () => {
        const cfg = resolveEnvironment(env);
        assert.equal(cfg.supabaseUrl, ENVIRONMENTS[env].supabaseUrl);
        assert.ok(cfg.publishableKey.length > 10);
      },
    );
  }

  it("pins the Supabase origin per environment", () => {
    const read = (url) => () =>
      `EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pk\n`;
    for (const bad of [
      "https://evil.example.com",
      "https://mizyun-supabase-dev.phiskel.com",
      "https://mizyun-supabase.phiskel.com.evil.example",
      "https://mizyun-supabase.phiskel.com/extra",
    ]) {
      assert.throws(
        () => resolveEnvironment("production", { readFile: read(bad) }),
        /expected production Supabase origin|HTTPS/,
        bad,
      );
    }
    assert.throws(
      () =>
        resolveEnvironment("dev", {
          readFile: read("https://mizyun-supabase.phiskel.com"),
        }),
      /expected dev Supabase origin/,
    );
    assert.equal(
      resolveEnvironment("dev", {
        readFile: read("https://mizyun-supabase-dev.phiskel.com/"),
      }).supabaseUrl,
      "https://mizyun-supabase-dev.phiskel.com",
    );
  });

  it("refuses redirects on every request", async () => {
    const h = makeDeps({
      factors: [{ id: "f1", factor_type: "totp", status: "verified" }],
    });
    const seen = [];
    const original = h.deps.fetch;
    h.deps.fetch = async (url, init) => {
      seen.push(init.redirect);
      return original(url, init);
    };
    assert.equal(await run(["--env", "production"], h.deps), 0);
    assert.ok(seen.length >= 4);
    assert.ok(seen.every((r) => r === "error"));
  });

  it("disables history and mutes echo in the TTY prompter", async () => {
    const written = [];
    const stderr = { isTTY: true, write: (c) => written.push(String(c)) };
    let options;
    const rl = {
      on() {},
      once() {},
      off() {},
      close() {},
      question(_prompt, cb) {
        options.output.write("typed-secret");
        cb("typed-secret");
      },
    };
    const prompter = createTtyPrompter({ isTTY: true }, stderr, {
      createInterface: (o) => ((options = o), rl),
    });
    assert.equal(options.historySize, 0);
    assert.equal(options.terminal, true);
    assert.equal(await prompter.askHidden("Password: "), "typed-secret");
    assert.ok(!written.join("").includes("typed-secret"));
    assert.equal(await prompter.ask("Email: "), "typed-secret");
    assert.ok(written.join("").includes("typed-secret"));
    assert.throws(
      () => createTtyPrompter({ isTTY: false }, stderr),
      /interactive terminal/,
    );
  });

  it("clears the enrollment secret from the screen on failure too", async () => {
    const h = makeDeps({
      factors: [],
      verifyStatus: 400,
      answers: [CODE, CODE, CODE],
    });
    h.stderr.isTTY = true;
    h.deps.clearScreen = undefined;
    assert.equal(await run(["--env", "production"], h.deps), 1);
    const text = h.stderr.text();
    const secretAt = text.indexOf(SECRET);
    const clearAt = text.indexOf("\x1b[2J");
    assert.ok(secretAt >= 0 && clearAt > secretAt);
    assert.ok(text.indexOf("Could not verify", clearAt) > clearAt);
    assert.equal(text.split("\x1b[2J").length, 2, "cleared exactly once");
  });

  it("refuses --print-export when stdout is a terminal", async () => {
    const h = makeDeps();
    h.stdout.isTTY = true;
    assert.equal(
      await run(["--env", "production", "--print-export"], h.deps),
      1,
    );
    assert.match(h.stderr.text(), /Refusing to print the token/);
    assert.equal(h.calls.length, 0);
  });

  it("does not spend an attempt on a malformed code", async () => {
    const factors = [{ id: "f1", factor_type: "totp", status: "verified" }];
    const h = makeDeps({ factors, answers: ["12", "abc", "1234567", CODE] });
    assert.equal(await run(["--env", "production"], h.deps), 0);
    assert.equal(
      h.calls.filter((c) => c.path.endsWith("/challenge")).length,
      1,
    );
    const endless = makeDeps({ factors, answers: Array(20).fill("x") });
    assert.equal(await run(["--env", "production"], endless.deps), 1);
    assert.equal(
      endless.calls.filter((c) => c.path.endsWith("/challenge")).length,
      0,
    );
  });

  it("explains an unconfirmed email", async () => {
    const h = makeDeps();
    h.deps.fetch = async () => ({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error_code: "email_not_confirmed",
          msg: "Email not confirmed",
        }),
    });
    assert.equal(await run(["--env", "production"], h.deps), 1);
    assert.match(h.stderr.text(), /email address is not confirmed/);
  });

  it("enrolls a TOTP factor, verifies and spawns the CLI with the token in the child env only", async () => {
    const h = makeDeps({ factors: [] });
    assert.equal(await run(["--env", "production"], h.deps), 0);
    const enroll = h.calls.find(
      (c) => c.method === "POST" && c.path === "/factors",
    );
    assert.equal(enroll.body.factor_type, "totp");
    assert.equal(enroll.body.friendly_name, FACTOR_FRIENDLY_NAME);
    assert.equal(enroll.headers.Authorization, `Bearer ${AAL1}`);
    assert.equal(enroll.headers.apikey.length > 0, true);
    const verify = h.calls.find((c) => c.path === "/factors/new-factor/verify");
    assert.deepEqual(verify.body, { challenge_id: "challenge-1", code: CODE });
    assert.match(h.stderr.text(), /otpauth:\/\/totp/);
    assert.match(h.stderr.text(), /shown ONCE/);
    assert.equal(h.stdout.text(), "");
    assert.equal(h.spawned.length, 1);
    const { args, opts } = h.spawned[0];
    assert.match(args[0], /community-moderation\.mjs$/);
    assert.deepEqual(args.slice(1), ["--env", "production", "--queue"]);
    assert.equal(opts.env.COMMUNITY_STAFF_ACCESS_TOKEN, AAL2);
    assert.equal(opts.env.API_URL, "https://mizyun-api.phiskel.com");
    assert.ok(!args.join(" ").includes(AAL2));
  });

  it("removes an unverified factor only after confirmation, then re-enrolls", async () => {
    const factors = [
      {
        id: "old",
        factor_type: "totp",
        status: "unverified",
        friendly_name: "x",
      },
    ];
    const h = makeDeps({ factors });
    h.deps.prompter.ask = async (q) =>
      /Remove it/.test(q) ? "y" : "mod@example.com";
    assert.equal(await run(["--env", "dev", "--", "--appeals"], h.deps), 0);
    assert.ok(
      h.calls.some((c) => c.method === "DELETE" && c.path === "/factors/old"),
    );
    assert.deepEqual(h.spawned[0].args.slice(1), ["--env", "dev", "--appeals"]);
    assert.equal(
      h.spawned[0].opts.env.API_URL,
      "https://mizyun-api-dev.phiskel.com",
    );

    const declined = makeDeps({ factors });
    declined.deps.prompter.ask = async (q) =>
      /Remove it/.test(q) ? "n" : "mod@example.com";
    assert.equal(await run(["--env", "dev"], declined.deps), 1);
    assert.ok(!declined.calls.some((c) => c.method === "DELETE"));
    assert.equal(declined.spawned.length, 0);
  });

  it("uses an existing verified factor without enrolling", async () => {
    const factors = [
      {
        id: "f1",
        factor_type: "totp",
        status: "verified",
        friendly_name: "Phone",
      },
    ];
    const h = makeDeps({ factors });
    assert.equal(
      await run(["--env", "production", "--", "--inspect", "r-1"], h.deps),
      0,
    );
    assert.ok(
      !h.calls.some((c) => c.method === "POST" && c.path === "/factors"),
    );
    assert.ok(h.calls.some((c) => c.path === "/factors/f1/challenge"));
    assert.ok(!h.stderr.text().includes("otpauth"));
    assert.deepEqual(h.spawned[0].args.slice(1), [
      "--env",
      "production",
      "--inspect",
      "r-1",
    ]);
  });

  it("handles a wrong code cleanly without spawning or leaking the code", async () => {
    const factors = [{ id: "f1", factor_type: "totp", status: "verified" }];
    const h = makeDeps({
      factors,
      verifyStatus: 400,
      answers: [CODE, CODE, CODE],
    });
    assert.equal(await run(["--env", "production"], h.deps), 1);
    assert.match(h.stderr.text(), /Wrong or expired code/);
    assert.match(h.stderr.text(), /Could not verify an authenticator code/);
    assert.equal(h.spawned.length, 0);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/verify")).length, 3);
    assert.ok(!all(h).includes(AAL1));
  });

  it("reports a bad password cleanly", async () => {
    const h = makeDeps();
    const original = h.deps.fetch;
    h.deps.fetch = async (url, init) =>
      new URL(url).pathname.endsWith("/token")
        ? {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ msg: `bad ${PASSWORD}` }),
          }
        : original(url, init);
    assert.equal(await run(["--env", "production"], h.deps), 1);
    assert.match(h.stderr.text(), /Sign-in failed/);
    assert.ok(!all(h).includes(PASSWORD));
    assert.equal(h.spawned.length, 0);
  });

  it("never prints the token in default mode, prints exports only with --print-export", async () => {
    const factors = [{ id: "f1", factor_type: "totp", status: "verified" }];
    const normal = makeDeps({ factors });
    assert.equal(await run(["--env", "production"], normal.deps), 0);
    for (const secret of [AAL1, AAL2, PASSWORD, CODE]) {
      assert.ok(!all(normal).includes(secret), "secret leaked in default mode");
    }

    const exported = makeDeps({ factors });
    assert.equal(
      await run(["--env", "production", "--print-export"], exported.deps),
      0,
    );
    assert.equal(
      exported.stdout.text(),
      `export COMMUNITY_STAFF_ACCESS_TOKEN='${AAL2}'\nexport API_URL='https://mizyun-api.phiskel.com'\n`,
    );
    assert.ok(!exported.stderr.text().includes(AAL2));
    assert.equal(exported.spawned.length, 0);
  });

  it("rejects a verify response that is not aal2", async () => {
    const factors = [{ id: "f1", factor_type: "totp", status: "verified" }];
    const h = makeDeps({ factors });
    const original = h.deps.fetch;
    h.deps.fetch = async (url, init) =>
      new URL(url).pathname.endsWith("/verify")
        ? {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ access_token: AAL1 }),
          }
        : original(url, init);
    assert.equal(await run(["--env", "production"], h.deps), 1);
    assert.match(h.stderr.text(), /aal2/);
    assert.equal(h.spawned.length, 0);
  });
});
