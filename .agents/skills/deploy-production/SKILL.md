---
name: deploy-production
description: >-
  Promote an accepted commit to the Hetzner Production backend (mizyun-api.service / port 4000). Strictly requires an explicit 40-character SHA that is an accepted ancestor of origin/main. Use when explicitly asked to deploy, promote, or release to production.
---

# Mizyun Production Promotion Skill

Use this skill when promoting an accepted, ancestor commit from `origin/main` to the Hetzner Production backend (`https://mizyun-api.phiskel.com`).

## 1. Quick Reference & Mandatory Gates

- **Target Host**: Hetzner CX23 in Helsinki (`mizyun-hetzner` SSH alias).
- **Target Path**: `/var/lib/mizyun/repo` (restricted `mizyun` user).
- **API Service**: `mizyun-api.service` (port 4000).
- **Database**: PostgreSQL 17 on port 5432 (`MIZYUN_PRODUCTION_DB_URL`).
- **Public Health Route**: `https://mizyun-api.phiskel.com/v1/health`.
- **Pre-promotion Backup**: Automatically executes `mizyun-backup-for-deploy.service` before applying schema migrations.

> [!CAUTION]
> Production promotion is **strict and fail-closed**:
>
> 1. Requires an explicit 40-character commit SHA (cannot use `HEAD` or omit).
> 2. The commit MUST be an ancestor of `origin/main` (branch rewinding or unmerged feature branches are rejected).
> 3. Mac working tree must be clean.
> 4. `pnpm check` AND `pnpm db:verify` MUST pass on the exact candidate commit before deployment begins.

---

## 2. Instant Preflight Check (<1s)

Run the fast preflight script to verify working tree, SHA format, `origin/main` ancestry, SSH connectivity, and remote health without burning exploration tokens:

```bash
pnpm deploy:production:preflight <full-40-character-sha>
```

Or dry-run the promotion protocol:

```bash
pnpm deploy:production --dry-run <full-40-character-sha>
```

---

## 3. Step-by-Step Production Promotion Workflow

### Step 1: Verify Candidate is Merged to Main

Fetch latest `origin/main` and verify ancestry:

```bash
git fetch origin main
git merge-base --is-ancestor <candidate-sha> origin/main
```

### Step 2: Candidate Verification

Ensure both repository checks and disposable database verification pass:

```bash
pnpm check
pnpm db:verify
```

### Step 3: Execute Production Promotion

Run the production deployment driver with the explicit full SHA:

```bash
pnpm deploy:production <full-40-character-sha>
```

**What the driver does automatically:**

1. Validates working tree is clean.
2. Fetches `origin/main` and confirms candidate ancestry.
3. Runs `pnpm check` and `pnpm db:verify` on candidate.
4. Verifies SSH connectivity and unique Hetzner host-role marker (`/etc/mizyun/host-role`).
5. Materializes `scripts/promote-production.sh` from `origin/main` and streams via SSH.
6. The remote host:
   - Acquires concurrency lock (`/tmp/mizyun-deploy-production.lock`).
   - Rejects dev checkouts, dev DB port 5433, or missing host markers.
   - Takes pre-deploy encrypted database/Storage backup (`mizyun-backup-for-deploy.service`).
   - Fetches commit and verifies ancestry.
   - Detaches to candidate commit and runs `pnpm install --frozen-lockfile`.
   - Reconciles migrations via `supabase db push --yes` against port 5432.
   - Restarts `mizyun-api.service`.
   - Polls local `/v1/health` and rolls back code if unhealthy.
7. Local driver smoke-tests `https://mizyun-api.phiskel.com/v1/health`.

---

## 4. Post-Promotion Verification & Evidence

Verify public production health:

```bash
curl -s https://mizyun-api.phiskel.com/v1/health
```

Test the journey on the physical iPhone Production build (`com.mizyun.app`).

Update `status.md` with:

- Exact deployed candidate SHA.
- Pre-deploy backup timestamp.
- Public health HTTP 200 verification.
- Device journey acceptance evidence.
