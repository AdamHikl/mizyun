#!/usr/bin/env node

/**
 * CLI utility to quickly inspect and triage user feedback from Supabase.
 *
 * Supports querying Production (default) or Dev, comparing against a local
 * processed-feedback ledger, and marking feedback items as processed.
 *
 * Usage:
 *   node scripts/check-user-feedback.mjs               # Show unprocessed feedback
 *   node scripts/check-user-feedback.mjs --all         # Show all feedback (processed + new)
 *   node scripts/check-user-feedback.mjs --mark <id>   # Mark an item as processed
 *   node scripts/check-user-feedback.mjs --mark-all    # Mark all currently fetched items as processed
 *   node scripts/check-user-feedback.mjs --unmark <id> # Unmark an item
 *   node scripts/check-user-feedback.mjs --json        # Output raw JSON
 *   node scripts/check-user-feedback.mjs --env dev     # Query dev database
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Locate or initialize processed-feedback state
const stateDir = path.join(
  rootDir,
  ".agents",
  "skills",
  "check-unprocessed-feedback",
);
const stateFile = path.join(stateDir, "processed-feedback.json");

function loadProcessedState() {
  if (!existsSync(stateFile)) {
    return { processed: [] };
  }
  try {
    const raw = readFileSync(stateFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return { processed: [] };
  }
}

function saveProcessedState(state) {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function parseArgs(argv) {
  const options = {
    env: "production",
    all: false,
    json: false,
    markId: null,
    markAll: false,
    unmarkId: null,
    note: "",
    sshAlias: process.env.MIZYUN_SSH_ALIAS || "rpserver",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all" || arg === "-a") {
      options.all = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--mark-all") {
      options.markAll = true;
    } else if (arg === "--mark" && i + 1 < argv.length) {
      options.markId = argv[++i];
    } else if (arg === "--unmark" && i + 1 < argv.length) {
      options.unmarkId = argv[++i];
    } else if (arg === "--note" && i + 1 < argv.length) {
      options.note = argv[++i];
    } else if (arg === "--env" && i + 1 < argv.length) {
      options.env = argv[++i].toLowerCase();
    } else if (arg === "--ssh" && i + 1 < argv.length) {
      options.sshAlias = argv[++i];
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Check & Triage In-App User Feedback

USAGE:
  node scripts/check-user-feedback.mjs [options]

OPTIONS:
  --all, -a              Show all feedback items (including already processed)
  --mark <id>            Mark a feedback item as processed
  --mark-all             Mark all currently unprocessed items as processed
  --unmark <id>          Remove an item from the processed ledger
  --note "<text>"        Attach an optional resolution note when marking
  --env <prod|dev>       Target environment (default: production)
  --ssh <alias>          SSH host alias (default: rpserver)
  --json                 Output raw JSON data
  --help, -h             Show this help message

EXAMPLES:
  # Check for any new, unprocessed feedback:
  node scripts/check-user-feedback.mjs

  # Mark a feedback item as processed:
  node scripts/check-user-feedback.mjs --mark 9f2cd667-4341-4ef2-ae73-7dcf1aafc928 --note "Logged feature request to backlog"

  # Mark all pending items as processed:
  node scripts/check-user-feedback.mjs --mark-all --note "Reviewed in triage"
`);
}

function fetchFeedbackFromDatabase(env, sshAlias) {
  const container = env === "dev" ? "mizyun-dev-db" : "supabase-db";
  const sql = `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT f.id, f.created_at, u.email, f.category, f.rating, f.message, f.context, f.media_asset_ids FROM public.user_feedback f LEFT JOIN auth.users u ON f.user_id = u.id ORDER BY f.created_at DESC) t;`;

  const cmd = `docker exec ${container} psql -U postgres -d postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`;

  const res = spawnSync("ssh", [sshAlias, cmd], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (res.status !== 0) {
    const errorMsg =
      res.stderr?.trim() || res.stdout?.trim() || "Unknown error";
    throw new Error(
      `Failed to query database on ${sshAlias} (${container}): ${errorMsg}`,
    );
  }

  const rawJson = res.stdout.trim();
  if (!rawJson) {
    return [];
  }

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `Failed to parse database output as JSON: ${err.message}\nRaw output:\n${rawJson}`,
    );
  }
}

const CATEGORY_BADGES = {
  like: "👍 [Like / Praise]",
  dislike: "👎 [Dislike / Criticism]",
  change: "💡 [Feature Request / Change]",
  bug: "🐛 [Bug Report]",
  general: "💬 [General Feedback]",
};

function formatStars(rating) {
  if (typeof rating !== "number" || rating < 1) return "None";
  return "⭐".repeat(rating) + ` (${rating}/5)`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const utcStr = date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  const localStr = date.toLocaleString();
  return `${utcStr}  (Local: ${localStr})`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const state = loadProcessedState();
  const processedMap = new Map(state.processed.map((p) => [p.id, p]));

  // Handle direct unmark
  if (options.unmarkId) {
    if (!processedMap.has(options.unmarkId)) {
      console.log(
        `Feedback ID ${options.unmarkId} was not in the processed list.`,
      );
      process.exit(0);
    }
    state.processed = state.processed.filter((p) => p.id !== options.unmarkId);
    saveProcessedState(state);
    console.log(
      `✓ Unmarked feedback ${options.unmarkId}. It is now considered unprocessed.`,
    );
    process.exit(0);
  }

  // Handle direct mark
  if (options.markId) {
    const existing = processedMap.get(options.markId);
    if (existing) {
      existing.processedAt = new Date().toISOString();
      if (options.note) existing.note = options.note;
    } else {
      state.processed.push({
        id: options.markId,
        processedAt: new Date().toISOString(),
        note: options.note || "Marked as processed",
      });
    }
    saveProcessedState(state);
    console.log(`✓ Feedback ${options.markId} marked as processed.`);
    process.exit(0);
  }

  // Fetch feedback from DB
  let allFeedback;
  try {
    allFeedback = fetchFeedbackFromDatabase(options.env, options.sshAlias);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error(
      `\nTip: Ensure SSH connectivity to '${options.sshAlias}' is working: ssh ${options.sshAlias} echo OK`,
    );
    process.exit(1);
  }

  // Handle mark-all
  if (options.markAll) {
    const unprocessed = allFeedback.filter(
      (item) => !processedMap.has(item.id),
    );
    if (unprocessed.length === 0) {
      console.log("No unprocessed feedback items to mark.");
      process.exit(0);
    }
    const now = new Date().toISOString();
    for (const item of unprocessed) {
      state.processed.push({
        id: item.id,
        processedAt: now,
        note: options.note || "Marked via --mark-all",
      });
    }
    saveProcessedState(state);
    console.log(`✓ Marked ${unprocessed.length} item(s) as processed.`);
    process.exit(0);
  }

  const unprocessed = allFeedback.filter((item) => !processedMap.has(item.id));
  const targetList = options.all ? allFeedback : unprocessed;

  if (options.json) {
    const output = targetList.map((item) => ({
      ...item,
      isProcessed: processedMap.has(item.id),
      processedMeta: processedMap.get(item.id) || null,
    }));
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  console.log("\n========================================================");
  console.log(` Mizyun In-App User Feedback [${options.env.toUpperCase()}]`);
  console.log("========================================================");
  console.log(`Total records in DB:    ${allFeedback.length}`);
  console.log(`Already processed:      ${state.processed.length}`);
  console.log(`Unprocessed / New:      ${unprocessed.length}`);
  console.log("========================================================\n");

  if (targetList.length === 0) {
    if (options.all) {
      console.log("No feedback entries found in the database.\n");
    } else {
      console.log("🎉 All caught up! There is no unprocessed feedback.\n");
      console.log("To view previous processed feedback, run with '--all':");
      console.log("  node scripts/check-user-feedback.mjs --all\n");
    }
    process.exit(0);
  }

  for (let i = 0; i < targetList.length; i++) {
    const item = targetList[i];
    const isProc = processedMap.has(item.id);
    const procInfo = processedMap.get(item.id);
    const statusTag = isProc ? "[PROCESSED]" : "[NEW]";
    const categoryBadge = CATEGORY_BADGES[item.category] || item.category;

    console.log(`--------------------------------------------------------`);
    console.log(`Item #${i + 1} of ${targetList.length} ${statusTag}`);
    console.log(`ID:          ${item.id}`);
    console.log(`Submitted:   ${formatDate(item.created_at)}`);
    console.log(`User:        ${item.email || "Anonymous / No Email"}`);
    console.log(`Category:    ${categoryBadge}`);
    console.log(`Rating:      ${formatStars(item.rating)}`);
    if (item.media_asset_ids && item.media_asset_ids.length > 0) {
      console.log(`Attachments: ${item.media_asset_ids.length} media asset(s)`);
    }
    if (isProc && procInfo) {
      console.log(
        `Processed:   ${procInfo.processedAt}${procInfo.note ? ` (${procInfo.note})` : ""}`,
      );
    }
    console.log(`Message:`);
    console.log(`  "${item.message.trim()}"`);
    if (item.context && Object.keys(item.context).length > 0) {
      console.log(`Context:     ${JSON.stringify(item.context)}`);
    }
    console.log();
  }

  if (!options.all && unprocessed.length > 0) {
    console.log("--------------------------------------------------------");
    console.log("💡 TRIAGE ACTIONS:");
    console.log("  To mark an item as processed:");
    console.log(
      `    node scripts/check-user-feedback.mjs --mark <id> [--note "reason"]`,
    );
    console.log("  To mark all above items as processed:");
    console.log(
      `    node scripts/check-user-feedback.mjs --mark-all [--note "reason"]`,
    );
    console.log("--------------------------------------------------------\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
