#!/usr/bin/env node

/** Named authenticated moderator sessions only. Offline drills are simulations. */
const SIMULATION_OPERATORS = {
  primary: "simulation-primary",
  backup: "simulation-reviewer",
};

export const SLA_TARGETS = {
  urgentHours: 4,
  normalHours: 24,
};

export const ALLOWED_ACTIONS = ["warn", "remove", "suspend", "ban", "dismiss"];

export const ALLOWED_APPEAL_DECISIONS = ["approved", "rejected"];

// Evidence remains unchanged; terminal output cannot execute control sequences.
const escapedCodePoint = (character) =>
  `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`;
const terminalText = (value) =>
  String(value).replace(
    /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    escapedCodePoint,
  );
const terminalJson = (value) =>
  JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    escapedCodePoint,
  );

export function parseArgs(argv) {
  const options = {
    command: "queue",
    reportId: null,
    appealId: null,
    action: null,
    reason: null,
    notes: null,
    decision: null,
    suspensionDays: undefined,
    env: process.env.NODE_ENV === "production" ? "production" : "dev",
    apiUrl: process.env.API_URL || null,
    accessToken: process.env.COMMUNITY_STAFF_ACCESS_TOKEN || null,
    json: false,
    mock: false,
    limit: 50,
    offset: 0,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--queue" || arg === "-q") {
      options.command = "queue";
    } else if (arg === "--appeals") {
      options.command = "appeals";
    } else if (arg === "--claim") {
      options.command = "claim";
      options.reportId = argv[++i];
    } else if (arg === "--inspect") {
      options.command = "inspect";
      options.reportId = argv[++i];
    } else if (arg === "--action") {
      options.command = "action";
      options.action = argv[++i]?.toLowerCase();
    } else if (arg === "--report") {
      options.reportId = argv[++i];
    } else if (arg === "--reason") {
      options.reason = argv[++i];
    } else if (arg === "--operator" || arg === "--secret") {
      throw new Error(
        "Shared secrets/operator names are unsupported. Use COMMUNITY_STAFF_ACCESS_TOKEN for your MFA staff session.",
      );
    } else if (arg === "--notes") {
      options.notes = argv[++i];
    } else if (arg === "--review-appeal") {
      options.command = "review-appeal";
      options.appealId = argv[++i];
    } else if (arg === "--decision") {
      options.decision = argv[++i]?.toLowerCase();
    } else if (arg === "--suspension-days") {
      const days = Number(argv[++i]);
      if (![7, 14, 30].includes(days)) {
        throw new Error("Invalid --suspension-days: must be 7, 14, or 30.");
      }
      options.suspensionDays = days;
    } else if (arg === "--drill") {
      options.command = "drill";
    } else if (arg === "--mock") {
      options.mock = true;
    } else if (arg === "--env") {
      options.env = argv[++i]?.toLowerCase();
    } else if (arg === "--limit") {
      options.limit = Number(argv[++i]);
    } else if (arg === "--offset") {
      options.offset = Number(argv[++i]);
    } else if (arg === "--api-url") {
      options.apiUrl = argv[++i];
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // Validate command specific parameters
  if (["inspect", "claim"].includes(options.command) && !options.reportId) {
    throw new Error(`--${options.command} requires a report ID.`);
  }

  if (options.command === "action") {
    if (!options.action || !ALLOWED_ACTIONS.includes(options.action)) {
      throw new Error(
        `Invalid --action: must be one of ${ALLOWED_ACTIONS.join(", ")}`,
      );
    }
    if (!options.reportId) {
      throw new Error("--action requires --report <id>.");
    }
    if (!options.reason) {
      throw new Error('--action requires --reason "<reason>".');
    }
    if (options.action === "suspend" && options.suspensionDays === undefined) {
      throw new Error("--action suspend requires --suspension-days <7|14|30>.");
    }
  }

  if (options.command === "review-appeal") {
    if (!options.appealId) {
      throw new Error("--review-appeal requires an appeal ID.");
    }
    if (
      !options.decision ||
      !ALLOWED_APPEAL_DECISIONS.includes(options.decision)
    ) {
      throw new Error(
        `--decision must be one of ${ALLOWED_APPEAL_DECISIONS.join(", ")}`,
      );
    }
  }

  if (!["dev", "production"].includes(options.env))
    throw new Error("--env must be dev or production.");
  if (options.mock && options.command !== "drill")
    throw new Error("--mock is only available for --drill.");
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 100 ||
    !Number.isInteger(options.offset) ||
    options.offset < 0 ||
    options.offset > 10000
  )
    throw new Error("Use --limit 1..100 and --offset 0..10000.");
  return options;
}

export function printUsage() {
  console.log(`
Mizyun Community Moderation Tool (COMM-09)
Set COMMUNITY_STAFF_ACCESS_TOKEN to your verified MFA staff session token.
Staff role grants and identity are enforced by the server; never share tokens.

COMMANDS:
  --queue                            List up to 50 active queue cases
  --inspect <reportId>                Inspect a staff report
  --claim <reportId>                  Claim a case for your authenticated account
  --appeals                          List pending appeals for independent review
  --action <warn|remove|suspend|ban|dismiss>
    --report <reportId> --reason "<reason>" [--notes "<notes>"] [--suspension-days <days>]
  --review-appeal <appealId> --decision <approved|rejected> [--notes "<notes>"]
  --drill --mock                      Offline simulation only; no acceptance evidence

OPTIONS:
  --env <dev|production>              Target environment (default: dev)
  --api-url <url>                     Custom HTTPS API (HTTP allowed only on loopback)
  --limit <1..100> --offset <0..10000> Queue/appeals page (default: 50, 0)
  --json                              Machine-readable output
  --help, -h                          Show help
`);
}

export function staffRequestHeaders(options) {
  if (!options.accessToken)
    throw new Error(
      "COMMUNITY_STAFF_ACCESS_TOKEN is required for live staff operations.",
    );
  return {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
  };
}

export function validateApiUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "Staff API must use HTTPS or loopback HTTP without embedded credentials/query/hash.",
    );
  }
  return url.href.replace(/\/$/, "");
}

export function calculateClock(createdAtStr, priority) {
  const createdAt = new Date(createdAtStr);
  const now = new Date();
  const elapsedMs = Math.max(0, now.getTime() - createdAt.getTime());
  const elapsedHours = (elapsedMs / (1000 * 60 * 60)).toFixed(1);
  const limitHours =
    priority === "urgent" ? SLA_TARGETS.urgentHours : SLA_TARGETS.normalHours;
  const remainingHours = (limitHours - elapsedMs / (1000 * 60 * 60)).toFixed(1);
  const isOverdue = elapsedMs > limitHours * 60 * 60 * 1000;

  return {
    elapsedHours,
    limitHours,
    remainingHours,
    isOverdue,
  };
}

export async function runMockDrill() {
  console.log(
    "=== OFFLINE SIMULATION: no API, database, staffing, or SLA acceptance ===",
  );
  const startTime = Date.now();

  // 1. Synthetic report generation
  const syntheticReportId = "10000000-0000-0000-0000-000000000001";
  const syntheticReporterId = "20000000-0000-0000-0000-000000000002";
  const syntheticTargetId = "30000000-0000-0000-0000-000000000003";

  console.log("Step 1: Generating synthetic urgent report...");
  const report = {
    id: syntheticReportId,
    reporterUserId: syntheticReporterId,
    targetType: "activity",
    targetId: syntheticTargetId,
    reason: "unsafe_or_sexual_content",
    notes: "Prohibited hazardous content shared in feed",
    priority: "urgent",
    status: "submitted",
    createdAt: new Date().toISOString(),
    assignedTo: null,
    decision: null,
    decisionReason: null,
    staffNotes: null,
  };
  console.log(`✓ Report created: ${report.id} [Priority: ${report.priority}]`);

  // 2. Queue triage & SLA clock calculation
  console.log("Step 2: Triaging queue and calculating SLA deadline...");
  const clock = calculateClock(report.createdAt, report.priority);
  console.log(
    `✓ Queue item triaged. Elapsed: ${clock.elapsedHours}h / SLA limit: ${clock.limitHours}h (Remaining: ${clock.remainingHours}h)`,
  );

  // 3. Primary operator action
  console.log(
    `Step 3: Primary operator [${SIMULATION_OPERATORS.primary}] acting on report...`,
  );
  report.status = "resolved";
  report.decision = "remove";
  report.decisionReason = "Violates safety policy on dangerous fitness content";
  report.staffNotes = "Sanction applied and card removed from feed";
  report.assignedTo = SIMULATION_OPERATORS.primary;
  report.actionTakenAt = new Date().toISOString();
  console.log(
    `✓ Decision executed: ${report.decision} by ${report.assignedTo}. Content removed.`,
  );

  // 4. Confidentiality validation: ensure reporter identity is withheld from subject views
  console.log("Step 4: Validating reporter confidentiality invariant...");
  const subjectExportView = {
    reportId: report.id,
    targetId: report.targetId,
    decision: report.decision,
    decisionReason: report.decisionReason,
    actionTakenAt: report.actionTakenAt,
  };
  if (
    "reporterUserId" in subjectExportView ||
    "staffNotes" in subjectExportView
  ) {
    throw new Error(
      "CONFIDENTIALITY LEAK: reporterUserId or staffNotes exposed in subject export!",
    );
  }
  console.log(
    "Simulation projection omits reporterUserId and staffNotes; real API/export isolation remains unverified.",
  );

  // 5. Synthetic appeal submission
  console.log("Step 5: Subject submitting moderation appeal...");
  const syntheticAppealId = "40000000-0000-0000-0000-000000000004";
  const appeal = {
    id: syntheticAppealId,
    reportId: syntheticReportId,
    appellantUserId: syntheticTargetId,
    reason: "My workout was a standard high-intensity routine, not dangerous.",
    status: "pending",
    reviewedBy: null,
    reviewerNotes: null,
  };
  console.log(`✓ Appeal submitted: ${appeal.id}`);

  // 6. Independent second review by backup operator
  console.log(
    `Step 6: Executing independent second review by [${SIMULATION_OPERATORS.backup}]...`,
  );
  if (SIMULATION_OPERATORS.backup === report.assignedTo) {
    throw new Error(
      "INDEPENDENT REVIEW VIOLATION: Appeal reviewer cannot be the primary deciding operator!",
    );
  }
  appeal.status = "approved";
  appeal.reviewedBy = SIMULATION_OPERATORS.backup;
  appeal.reviewerNotes =
    "Second review finds the exercise was standard mobility routine. Sanction revoked.";
  appeal.resolvedAt = new Date().toISOString();
  console.log(
    `✓ Appeal resolved: ${appeal.status} by ${appeal.reviewedBy}. Independent second-review rule verified.`,
  );

  const durationMs = Date.now() - startTime;
  console.log("\n=======================================================");
  console.log(`✓ OFFLINE SIMULATION COMPLETED in ${durationMs}ms`);
  console.log(
    "No runtime, trained backup, coverage, contact, or deployment acceptance was exercised.",
  );
  console.log("=======================================================\n");

  return {
    success: true,
    evidenceTier: "offline_simulation",
    durationMs,
    report,
    appeal,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let options;
  try {
    options = parseArgs(args);
  } catch (err) {
    console.error(`Error: ${terminalText(err.message)}`);
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (options.command === "drill") {
    if (!options.mock)
      throw new Error(
        "Live drills require provisioned cases and a second trained staff session; use --drill --mock only for offline simulation.",
      );
    await runMockDrill();
    return;
  }

  console.log(`Target Environment: ${options.env}`);
  const baseUrl = validateApiUrl(
    options.apiUrl ||
      (options.env === "production"
        ? "https://mizyun-api.phiskel.com"
        : "https://mizyun-api-dev.phiskel.com"),
  );
  const headers = staffRequestHeaders(options);

  console.log(`Connecting to API at ${baseUrl}...`);

  try {
    if (options.command === "queue") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/queue?limit=${options.limit}&offset=${options.offset}`,
        {
          headers,
          redirect: "error",
        },
      );

      if (!res.ok) {
        throw new Error(`Staff API error (${res.status}): ${await res.text()}`);
      }

      const queue = await res.json();
      if (options.json) {
        console.log(terminalJson(queue));
        return;
      }

      console.log(`\n=== Staff Moderation Queue (${queue.length} items) ===\n`);
      if (queue.length === 0) {
        console.log("Queue is currently clear. No pending reports.");
        return;
      }

      for (const item of queue) {
        const clock = calculateClock(item.createdAt, item.priority);
        const alertTag = clock.isOverdue ? " [OVERDUE]" : "";
        console.log(
          `[${terminalText(item.priority.toUpperCase())}${alertTag}] Case ${terminalText(item.id)}`,
        );
        console.log(
          `  Target:   ${terminalText(item.targetType)} (${terminalText(item.targetId)})`,
        );
        console.log(`  Reason:   ${terminalText(item.reason)}`);
        console.log(`  Status:   ${terminalText(item.status)}`);
        console.log(
          `  Clock:    ${clock.elapsedHours}h elapsed / ${clock.limitHours}h SLA (${clock.remainingHours}h remaining)`,
        );
        if (item.notes) {
          console.log(`  Notes:    ${terminalJson(item.notes)}`);
        }
        console.log("-------------------------------------------------------");
      }
    } else if (options.command === "appeals") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/appeals?limit=${options.limit}&offset=${options.offset}`,
        {
          headers,
          redirect: "error",
        },
      );
      if (!res.ok) throw new Error(`Staff appeals error (${res.status})`);
      console.log(terminalJson(await res.json()));
    } else if (options.command === "claim") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/reports/${encodeURIComponent(options.reportId)}/claim`,
        {
          method: "POST",
          headers: { Authorization: headers.Authorization },
          redirect: "error",
        },
      );
      if (!res.ok) throw new Error(`Staff claim error (${res.status})`);
      console.log(terminalJson(await res.json()));
    } else if (options.command === "inspect") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/reports/${encodeURIComponent(options.reportId)}`,
        { headers, redirect: "error" },
      );
      if (!res.ok) throw new Error(`Staff inspect error (${res.status})`);
      console.log(terminalJson(await res.json()));
    } else if (options.command === "action") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/reports/${encodeURIComponent(options.reportId)}/action`,
        {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({
            action: options.action,
            reason: options.reason,
            staffNotes: options.notes,
            suspensionDurationDays: options.suspensionDays,
          }),
        },
      );

      if (!res.ok) {
        throw new Error(
          `Staff Action error (${res.status}): ${await res.text()}`,
        );
      }

      const result = await res.json();
      console.log(
        `✓ Moderation action [${terminalText(options.action)}] applied by authenticated staff on case ${terminalText(options.reportId)}.`,
      );
      if (options.json) {
        console.log(terminalJson(result));
      }
    } else if (options.command === "review-appeal") {
      const res = await fetch(
        `${baseUrl}/v1/community/staff/appeals/${encodeURIComponent(options.appealId)}/review`,
        {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({
            decision: options.decision,
            reviewerNotes: options.notes,
          }),
        },
      );

      if (!res.ok) {
        throw new Error(
          `Appeal Review error (${res.status}): ${await res.text()}`,
        );
      }

      const result = await res.json();
      console.log(
        `✓ Appeal [${terminalText(options.decision)}] by authenticated reviewer on appeal ${terminalText(options.appealId)}.`,
      );
      if (options.json) {
        console.log(terminalJson(result));
      }
    }
  } catch (err) {
    console.error(`Execution failed: ${terminalText(err.message)}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("community-moderation.mjs")) {
  main().catch((err) => {
    console.error(terminalText(err.message));
    process.exit(1);
  });
}
