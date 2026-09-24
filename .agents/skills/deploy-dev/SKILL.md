---
name: deploy-dev
description: >-
  Deploy a verified commit or current branch to the Hetzner Development backend (mizyun-api-dev.service / port 4100). Use when asked to deploy to dev, push backend changes, or verify on the development server. Skip for production promotion or client-only tasks.
---

# Mizyun Dev Deployment Skill

Use this skill when deploying code to the Hetzner Development backend (`https://mizyun-api-dev.phiskel.com`).

## 1. Quick Reference & Core Rules

- **Target Host**: Hetzner CX23 in Helsinki (`mizyun-hetzner-dev` SSH alias).
- **Target Path**: `/var/lib/mizyun/dev/repo` (restricted `mizyun-dev-deploy` user).
- **API Service**: `mizyun-api-dev.service` (port 4100).
- **Database**: PostgreSQL 17 on port 5433 (`MIZYUN_DEV_DB_URL`).
- **Authentication**: Dedicated read-only GitHub Deploy Key (`mizyun-dev-deploy@hetzner`) fetching from `git@github.com:AdamHikl/mizyun.git`.
- **Public Health Route**: `https://mizyun-api-dev.phiskel.com/v1/health`.

> [!IMPORTANT]
> The Mac working tree must be clean before deploying. Commit or stash local changes first.

---

## 2. Instant Preflight Check (<1s)

Run the fast preflight script to verify working tree, candidate commit, SSH connectivity, and remote health without burning exploration tokens:

```bash
pnpm deploy:dev:preflight [candidate-sha]
```

Or dry-run the deployment protocol:

```bash
pnpm deploy:dev --dry-run [candidate-sha]
```

---

## 3. Step-by-Step Deployment Workflow

### Step 1: Verify Candidate Commit

Ensure quality gates pass on the commit to be deployed:

```bash
pnpm check
```

### Step 2: Execute Deployment

Run the dev deployment driver. If no SHA is passed, it deploys `HEAD`:

```bash
pnpm deploy:dev [full-40-char-sha]
```

**What the driver does automatically:**

1. Validates working tree cleanliness.
2. Runs `pnpm check` on the candidate commit (in an isolated worktree if not HEAD).
3. Pushes the branch or temporary ref (`deploy-tmp-<sha>`) to GitHub `origin`.
4. Connects via SSH to `mizyun-hetzner-dev` and verifies the unique host-role marker (`/etc/mizyun/host-role`).
5. Materializes and streams `scripts/promote-dev.sh` from `origin/main` to the remote server.
6. The remote host:
   - Acquires concurrency lock (`/tmp/mizyun-deploy-dev.lock`).
   - Verifies `safe.directory` is restricted to `/var/lib/mizyun/dev/repo`.
   - Fetches commit from GitHub over SSH using the deploy key.
   - Detaches to target commit and runs `CI=true pnpm install --frozen-lockfile`.
   - Reconciles migrations via `supabase db push --yes` against port 5433.
   - Restarts `mizyun-api-dev.service` via narrow sudoers rule.
   - Polls local `/v1/health` and rolls back code if unhealthy.
7. The local driver smoke-tests the public endpoint `https://mizyun-api-dev.phiskel.com/v1/health`.

---

## 4. Post-Deployment Verification & Evidence

Verify public health and check remote release journal:

```bash
curl -s https://mizyun-api-dev.phiskel.com/v1/health
```

Update `status.md` with:

- Exact deployed commit SHA.
- Public health HTTP 200 response with timestamp.
- Note whether device acceptance was performed or pending.
