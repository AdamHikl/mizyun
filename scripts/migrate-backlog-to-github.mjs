#!/usr/bin/env node

/**
 * migrate-backlog-to-github.mjs
 *
 * Migrates tasks from backlog.md and completed-backlog.md into GitHub Issues
 * on AdamHikl/mizyun using the GitHub CLI (`gh`).
 *
 * Usage:
 *   node scripts/migrate-backlog-to-github.mjs
 *   node scripts/migrate-backlog-to-github.mjs --apply
 *   node scripts/migrate-backlog-to-github.mjs --apply --labels-only
 *
 * This is retained as migration evidence. It defaults to a read-only dry run
 * and refuses to apply again after the durable migration report exists.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const LABELS_ONLY = process.argv.includes("--labels-only");
const OPEN_ONLY = !process.argv.includes("--include-completed");

const LABELS = [
  // Priorities
  {
    name: "priority:P0",
    color: "b60205",
    description: "MVP blocker or critical release gate",
  },
  {
    name: "priority:P1",
    color: "d93f0b",
    description: "MVP-critical deliverable",
  },
  {
    name: "priority:P2",
    color: "fbca04",
    description: "Valuable enhancement or secondary platform",
  },
  {
    name: "priority:P3",
    color: "0e8a16",
    description: "Optional or future refinement",
  },

  // Statuses
  {
    name: "status:active",
    color: "6f42c1",
    description: "In progress / active work package",
  },
  { name: "status:ready", color: "0366d6", description: "Ready to implement" },
  {
    name: "status:blocked",
    color: "d73a4a",
    description: "Blocked by external input or dependency",
  },
  {
    name: "status:research",
    color: "0075ca",
    description: "Needs technical spike or research",
  },
  {
    name: "status:done",
    color: "6a737d",
    description: "Completed and verified",
  },
  {
    name: "status:superseded",
    color: "cfd3d7",
    description: "Superseded by alternative design",
  },

  // Areas
  {
    name: "area:google-play",
    color: "34a853",
    description: "Google Play publishing & Android release",
  },
  {
    name: "area:apple-store",
    color: "007aff",
    description: "Apple App Store, TestFlight & Apple Auth",
  },
  {
    name: "area:branding",
    color: "1d76db",
    description: "Branding, icons, splash, design tokens",
  },
  {
    name: "area:session",
    color: "bfdadc",
    description: "Session engineering & developer tooling",
  },
  {
    name: "area:remediation",
    color: "e99695",
    description: "Q1–Q9 remediation release gates",
  },
  {
    name: "area:infra",
    color: "5319e7",
    description: "Raspberry Pi, dual-environment, self-hosted backend",
  },
  {
    name: "area:alpha",
    color: "fef2c0",
    description: "Manual alpha testing & dogfooding",
  },
  {
    name: "area:ai",
    color: "c2e0c6",
    description: "AI model providers, prompts, safety moderation",
  },
  {
    name: "area:workout",
    color: "e11d48",
    description: "Workouts hub, routine builder, sets, exercises",
  },
  {
    name: "area:nutrition",
    color: "16a34a",
    description: "Meal logging, macro tracking, food database",
  },
  {
    name: "area:coach",
    color: "8b5cf6",
    description: "Conversational coach & action proposals",
  },
  {
    name: "area:auth",
    color: "0284c7",
    description: "Authentication, user profiles, sessions",
  },
  {
    name: "area:docs",
    color: "0075ca",
    description: "Documentation, navigation, agent guidelines",
  },
  {
    name: "area:feedback",
    color: "f97316",
    description: "In-app feedback, reviews, bug reporting",
  },
  {
    name: "area:analytics",
    color: "14b8a6",
    description: "Product analytics backend & reporting",
  },
  {
    name: "area:offline",
    color: "64748b",
    description: "Offline caching & network resilience",
  },
];

function determineArea(id, section) {
  const upperId = id.toUpperCase();
  const lowerSec = (section || "").toLowerCase();

  if (upperId.startsWith("PLAY-") || upperId === "MOB-AND-001")
    return "area:google-play";
  if (upperId.startsWith("APPLE-") || upperId.startsWith("STORE-"))
    return "area:apple-store";
  if (
    upperId.startsWith("BRAND-") ||
    upperId.startsWith("IA-") ||
    upperId.startsWith("MOB-DASH-") ||
    upperId.startsWith("MOB-DAILY-")
  )
    return "area:branding";
  if (upperId.startsWith("DOCS-") || upperId.startsWith("AGENT-SKILLS-"))
    return "area:docs";
  if (
    upperId.startsWith("INFRA-") ||
    upperId.startsWith("BE-") ||
    upperId.startsWith("TOOL-") ||
    upperId.startsWith("CFG-") ||
    upperId.startsWith("API-") ||
    upperId.startsWith("OPS-") ||
    upperId === "AND-001"
  )
    return "area:infra";
  if (upperId.startsWith("REL-AUD-") || upperId.startsWith("REL-"))
    return "area:remediation";
  if (
    upperId.startsWith("AI-BUDGET-") ||
    upperId.startsWith("BETA-PRO-") ||
    upperId === "BILL-001"
  )
    return "area:session";
  if (upperId.startsWith("OFFLINE-")) return "area:offline";
  if (
    upperId.startsWith("FIX-COACH-") ||
    upperId.startsWith("COACH-") ||
    upperId.startsWith("AI-CONV-") ||
    upperId.startsWith("AI-MOB-")
  )
    return "area:coach";
  if (
    upperId.startsWith("AI-ACT-") ||
    upperId.startsWith("AI-ENERGY-") ||
    upperId.startsWith("AI-ROUTINE-") ||
    upperId.startsWith("AI-APP-") ||
    upperId.startsWith("AI-LIFT-") ||
    upperId.startsWith("AI-BODY-") ||
    upperId.startsWith("AI-WORKOUT-")
  )
    return "area:coach";
  if (
    upperId.startsWith("AI-FOOD-") ||
    upperId.startsWith("VISION-") ||
    upperId.startsWith("NUT-") ||
    upperId.startsWith("MOB-NUT-") ||
    upperId.startsWith("MEAL-") ||
    upperId.startsWith("ENG-") ||
    upperId.startsWith("FIX-MEAL-") ||
    upperId.startsWith("FIX-AI-PHOTO-") ||
    upperId.startsWith("AI-EST-")
  )
    return "area:nutrition";
  if (upperId.startsWith("AI-")) return "area:ai";
  if (
    upperId.startsWith("WO-") ||
    upperId.startsWith("EX-") ||
    upperId.startsWith("MOB-WO-") ||
    upperId.startsWith("BODY-") ||
    upperId.startsWith("MOB-BODY-") ||
    upperId.startsWith("IOS-HEALTH-") ||
    upperId.startsWith("AND-HEALTH-") ||
    upperId.startsWith("FIX-WORKOUT-")
  )
    return "area:workout";
  if (
    upperId.startsWith("AUTH-") ||
    upperId.startsWith("PROF-") ||
    upperId.startsWith("GOAL-") ||
    upperId.startsWith("DATA-") ||
    upperId.startsWith("SEC-") ||
    upperId.startsWith("UX-") ||
    upperId.startsWith("MOB-ONB-")
  )
    return "area:auth";
  if (upperId.startsWith("FEEDBACK-")) return "area:feedback";
  if (upperId.startsWith("OBS-")) return "area:analytics";
  if (upperId.startsWith("ALPHA-")) return "area:alpha";
  if (upperId.startsWith("LOCAL-WORKER-")) return "area:session";

  if (lowerSec.includes("play")) return "area:google-play";
  if (lowerSec.includes("apple") || lowerSec.includes("store"))
    return "area:apple-store";
  if (
    lowerSec.includes("brand") ||
    lowerSec.includes("icon") ||
    lowerSec.includes("splash")
  )
    return "area:branding";
  if (lowerSec.includes("session")) return "area:session";
  if (lowerSec.includes("infra")) return "area:infra";
  if (lowerSec.includes("remediation") || lowerSec.includes("audit"))
    return "area:remediation";
  if (lowerSec.includes("coach")) return "area:coach";
  if (lowerSec.includes("workout")) return "area:workout";
  if (lowerSec.includes("nutrition") || lowerSec.includes("meal"))
    return "area:nutrition";
  if (lowerSec.includes("ai")) return "area:ai";

  return "area:session";
}

function runGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(`gh ${args.join(" ")} failed: ${stderr}`);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMarkdownBacklog(content, defaultFileSource) {
  const lines = content.split("\n");
  const items = [];
  let currentSection = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      currentSection = line.replace("## ", "").trim();

      const secTaskMatch = currentSection.match(
        /^(.+?)\s+\(`([A-Z0-9_-]+)`,\s*([^)]+)\)/,
      );
      if (secTaskMatch) {
        const title = secTaskMatch[1].trim();
        const id = secTaskMatch[2].trim();
        const date = secTaskMatch[3].trim();
        let bodyLines = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("## ")) {
          if (lines[j].trim()) bodyLines.push(lines[j]);
          j++;
        }
        items.push({
          id,
          priority: "P1",
          status: "done",
          title,
          details: bodyLines.join("\n").trim() || `Completed on ${date}`,
          section: currentSection,
          source: defaultFileSource,
        });
      }
      continue;
    }

    const nonTableMatch = line.match(
      /^\s*-\s*\*\*([A-Z0-9_-]+)\s*—\s*([^.*]+?)\.?\*\*\s*(.*)/,
    );
    if (nonTableMatch && nonTableMatch[1].includes("-")) {
      const id = nonTableMatch[1].trim();
      const rest = nonTableMatch[3].trim();
      let nextLine = "";
      if (i + 1 < lines.length && lines[i + 1].startsWith("  - **Exit:**")) {
        nextLine = lines[i + 1].trim();
      }
      items.push({
        id,
        priority: "P1",
        status: "ready",
        title: "Shared agent skills implementation guide and evaluation",
        details: [rest, nextLine].filter(Boolean).join("\n"),
        section: currentSection,
        source: defaultFileSource,
      });
      continue;
    }

    const match = line.match(
      /^\|\s*([A-Z0-9+_/-]+)\s*\|\s*(P\d+)\s*\|\s*([a-z]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/,
    );
    if (match) {
      const id = match[1].trim();
      if (id === "ID" || id.startsWith("---")) continue;
      const priority = match[2].trim();
      const status = match[3].trim();
      const title = match[4].trim();
      const details = match[5].trim();

      items.push({
        id,
        priority,
        status,
        title,
        details,
        section: currentSection,
        source: defaultFileSource,
      });
    }
  }

  return items;
}

async function createLabels() {
  console.log(`📌 Ensuring ${LABELS.length} GitHub labels exist...`);
  for (const label of LABELS) {
    if (DRY_RUN) {
      console.log(
        `[DRY-RUN] Create/Update label: ${label.name} (#${label.color})`,
      );
      continue;
    }
    try {
      runGh([
        "label",
        "create",
        label.name,
        "--color",
        label.color,
        "--description",
        label.description,
        "--force",
      ]);
      console.log(`  ✓ Label: ${label.name}`);
    } catch (err) {
      console.error(`  ✗ Error creating label ${label.name}: ${err.message}`);
    }
  }
}

async function main() {
  console.log("🚀 Mizyun Backlog to GitHub Issues Migration");
  console.log(
    `Mode: DRY_RUN=${DRY_RUN}, LABELS_ONLY=${LABELS_ONLY}, OPEN_ONLY=${OPEN_ONLY}`,
  );

  const reportPath = path.join(
    REPO_ROOT,
    "docs",
    "archive",
    "task-migration-report.json",
  );
  if (APPLY && !LABELS_ONLY) {
    try {
      await fs.access(reportPath);
      throw new Error(
        `Refusing to re-apply the one-time migration because ${reportPath} already exists.`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  await createLabels();
  if (LABELS_ONLY) {
    console.log("Done (--labels-only specified).");
    return;
  }

  const backlogContent = await fs.readFile(
    path.join(REPO_ROOT, "backlog.md"),
    "utf8",
  );
  const completedContent = await fs.readFile(
    path.join(REPO_ROOT, "completed-backlog.md"),
    "utf8",
  );

  const openTasks = parseMarkdownBacklog(backlogContent, "backlog.md");
  const completedTasks = OPEN_ONLY
    ? []
    : parseMarkdownBacklog(completedContent, "completed-backlog.md");

  console.log(`\n📋 Parsed tasks:`);
  console.log(`- Backlog (open tasks): ${openTasks.length}`);
  console.log(`- Completed Backlog (historical): ${completedTasks.length}`);
  console.log(
    `- Total tasks to process: ${openTasks.length + completedTasks.length}\n`,
  );

  const results = [];
  let processedCount = 0;

  for (const task of openTasks) {
    processedCount++;
    const area = determineArea(task.id, task.section);
    const priorityLabel = `priority:${task.priority}`;
    const statusLabel = `status:${task.status}`;
    const labels = [priorityLabel, statusLabel, area].join(",");

    const title = `[${task.id}] ${task.title}`;
    const body = `### Work Item
${task.title}

### Exit / Acceptance Criteria
${task.details}

### Metadata
- **ID:** \`${task.id}\`
- **Priority:** \`${task.priority}\`
- **Status:** \`${task.status}\`
- **Section:** ${task.section}
- **Migrated from:** \`${task.source}\`
`;

    console.log(
      `[${processedCount}/${openTasks.length + completedTasks.length}] Creating OPEN: ${title} (${labels})`,
    );

    if (DRY_RUN) {
      results.push({
        id: task.id,
        title,
        labels,
        state: "open",
        issueUrl: "DRY_RUN",
        issueNumber: processedCount,
      });
      continue;
    }

    try {
      const issueUrl = runGh([
        "issue",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--label",
        labels,
      ]);
      const match = issueUrl.match(/\/issues\/(\d+)/);
      const issueNumber = match ? parseInt(match[1], 10) : null;
      console.log(`  ✓ Created ${issueUrl}`);
      results.push({
        id: task.id,
        title,
        labels,
        state: "open",
        issueUrl,
        issueNumber,
      });
      await sleep(600);
    } catch (err) {
      console.error(
        `  ✗ Failed to create issue for ${task.id}: ${err.message}`,
      );
      results.push({ id: task.id, title, error: err.message });
    }
  }

  for (const task of completedTasks) {
    processedCount++;
    const area = determineArea(task.id, task.section);
    const priorityLabel = `priority:${task.priority}`;
    const statusLabel =
      task.status === "superseded" ? "status:superseded" : "status:done";
    const labels = [priorityLabel, statusLabel, area].join(",");

    const title = `[${task.id}] ${task.title}`;
    const body = `### Work Item
${task.title}

### Verified Implementation Evidence / Acceptance
${task.details}

### Metadata
- **ID:** \`${task.id}\`
- **Priority:** \`${task.priority}\`
- **Status:** \`${task.status}\`
- **Section:** ${task.section}
- **Migrated from:** \`${task.source}\`
`;

    console.log(
      `[${processedCount}/${openTasks.length + completedTasks.length}] Creating & Closing COMPLETED: ${title} (${labels})`,
    );

    if (DRY_RUN) {
      results.push({
        id: task.id,
        title,
        labels,
        state: "closed",
        issueUrl: "DRY_RUN",
        issueNumber: processedCount,
      });
      continue;
    }

    try {
      const issueUrl = runGh([
        "issue",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--label",
        labels,
      ]);
      const match = issueUrl.match(/\/issues\/(\d+)/);
      const issueNumber = match ? parseInt(match[1], 10) : null;

      if (issueNumber) {
        runGh(["issue", "close", String(issueNumber), "--reason", "completed"]);
      }
      console.log(`  ✓ Created & Closed ${issueUrl}`);
      results.push({
        id: task.id,
        title,
        labels,
        state: "closed",
        issueUrl,
        issueNumber,
      });
      await sleep(600);
    } catch (err) {
      console.error(
        `  ✗ Failed to process completed issue for ${task.id}: ${err.message}`,
      );
      results.push({ id: task.id, title, error: err.message });
    }
  }

  if (DRY_RUN) {
    console.log(
      "\nDry run complete; no GitHub state or report file was changed.",
    );
    return;
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(results, null, 2), "utf8");
  console.log(
    `\n🎉 Migration complete! Wrote migration report to ${reportPath}`,
  );
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
