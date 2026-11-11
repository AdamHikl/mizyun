# Public repository checklist

How to make this repository public for a limited period and make it private
again afterwards. Created 2026-11-06 for the BYOP (Labelbox / Alignerr) project
submission.

## Before making it public

- [x] Choose a license and add `LICENSE` at the root: AGPL v3 (chosen
      2026-11-06). The license applies to every version that is ever public
      and cannot be withdrawn for copies people have already taken. BYOP
      accepts AGPL only after an extra approval; do not start sessions until
      they confirm it.
- [ ] Read the BYOP contributor terms before signing. Check what rights they
      take to the code and to session transcripts, and whether the repository
      must stay public for a set period.
- [ ] Submit honestly: the form must disclose that Production stores about ten
      known users' meal and exercise logs, that those users agreed, and that
      sessions touch only code and local/Dev environments.
- [ ] Review open and closed GitHub Issues and pull requests. They become
      public with the code. Edit or close any that quote a real user's
      feedback, email address or account details.
- [ ] Confirm that every screenshot in the tree and history shows only
      synthetic or owner accounts.
- [ ] Accept that the full history becomes public: Hetzner hostnames, SSH
      aliases, service names, backup design and the owner's email addresses.
      None are secrets. The rules forbid rewriting history to remove them.
- [ ] Link `adam.hikl@outlook.com` to the GitHub account so commits show as
      the owner's.
- [ ] Rerun `gitleaks git --redact .` and confirm that every finding is still
      a known false positive: evidence-manifest hashes, `test-*` keys, PEM
      header handling or the public `supabase-demo` JWTs.
- [ ] Confirm that GitHub secret scanning and push protection are enabled.

## Making it public

```bash
gh repo edit AdamHikl/mizyun --visibility public --accept-visibility-change-consequences
```

## While it is public

- Never commit real user data, production exports, `.env` files or keys.
- Production data stays out of every session. Use local or Dev synthetic
  accounts only.

## Making it private again

Do this only after the BYOP work ends and its terms allow it.

```bash
gh repo edit AdamHikl/mizyun --visibility private --accept-visibility-change-consequences
```

What this does and does not undo:

- Stars and watchers are removed. Public forks stay public, become separate
  repositories and keep their copy of the code.
- Anyone who cloned or forked the repository keeps the version they took,
  under the license it had then. Later commits stay private.
- Copyright stays with the owner throughout. A public license grants rights;
  it does not transfer ownership.
