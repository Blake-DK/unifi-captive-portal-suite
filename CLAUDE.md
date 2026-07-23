# CLAUDE.md: project standing orders

Guest captive portal for UniFi (Next.js 16 App Router, TypeScript, Prisma 7 +
PostgreSQL, Tailwind 4). Docs of record: README.md (setup/reference),
docs/STATUS.md (current state + deployment facts), docs/ROADMAP.md (plans),
CHANGELOG.md (generated; never edit by hand). All other project docs
(ARCHITECTURE/OPERATIONS/GO-LIVE/GDPR) live under docs/ too; only README,
CHANGELOG and CLAUDE.md stay at the repo root.

## Workflow (non-negotiable)

- **Two release lines, PR-gated**: work happens on `feature/*` / `fix/*`
  branches that PR into `develop` (required checks, bare GitHub Actions job
  names, not the old Gitea `Workflow / job` style: `test`, `trivy-scan`,
  `gitleaks`, `semgrep`); each merge to develop auto-tags a PATCH-only
  `dev-v*` bump and ships the `:develop` image. `main` (stable) is reached
  ONLY by a develop→main promotion PR (also requires `security/snyk
  (blakey108)`, Snyk's native GitHub App check, not a workflow job; use
  plain merge; squash is the repo default for feature PRs but would blind
  semantic-release on promotions);
  semantic-release then cuts the real semver and `:latest`. Weekly security
  cron: Mon 06:00 (image scans).
- **Nightly line (deliberate exception)**: the `nightly` branch is UNGATED: direct pushes allowed, no protection, and a push triggers only
  `nightly-build.yml` (`:nightly` image, CHANNEL=nightly; no tests, no
  scanners, no version bump/tags). It exists for fast iteration; work still
  reaches `develop` through normal `feature/*` PRs. update.sh and the in-app
  update check follow it by branch-head commit SHA (channel "nightly").
  Never point a host you care about at `:nightly`.
- **PR merges are check-gated**: branch protection on `main` and `develop`
  requires the listed status checks green before the merge button unlocks —
  no bot-approval review step, just required checks (GitHub's private-repo
  branch protection needs a paid plan; this repo is on Pro). Real
  merge-error quirks (if any) get documented here once we've actually hit
  them on GitHub rather than assumed from the old Gitea behavior.
- **Back-merge `main` into `develop` after every release and after every
  docs-only push to main** (rule earned 2026-07-08): otherwise
  `block_on_outdated_branch` 405s the next promotion and semantic-release
  re-counts already-released commits (that is how v2.1.0 became v3.0.0).
- **CI identity is the default `GITHUB_TOKEN`**, scoped per-workflow via an
  explicit `permissions:` block (`contents: write` for tag/release pushes,
  `packages: write` for the ghcr.io push). No bot account, no PAT to
  rotate — merges gate on required status checks alone.
- **Code never pushes `main` directly.** Every code change = branch → push →
  PR via the GitHub REST API → merge only when the user explicitly says so.
- **Exception: documentation-only changes go straight to `main`** (user
  rule, 2026-07-07): README.md/CLAUDE.md/docs/** with no code, script,
  workflow, or schema edits in the same commit. Commit as `docs:` (no
  release). Mixed changes still take a PR; CHANGELOG.md stays generated; never hand-edit.
- **Deploy only when the user explicitly asks** ("deploy to prod"). Deploy =
  `./deploy.sh` on this host, after the `release-and-publish` CI run for the
  merge commit succeeds. It pulls `:latest`, restarts, health-checks, prunes.
- **Conventional Commits** drive semantic-release: `feat:` = minor, `fix:` =
  patch, `docs:`/`chore:` = no release (that is correct, not a bug). Write
  commit types accordingly so versions bump per industry standard.
- Commit trailer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- After README/CHANGELOG/ROADMAP/STATUS change and merge: refresh the GitHub
  wiki mirror (clone `.wiki.git`, prepend each page's mirror-note line, push).

## Environment constraints

- **No Node/npm on this host.** Don't try `npm run build` / `tsc` / `prisma
  migrate dev`. Hand-author `prisma/migrations/<UTC-stamp>_<name>/migration.sql`
  matching existing style; migrations run on container boot. If a build check
  is essential, use `docker run --rm -v "$PWD":/app -w /app node:24-alpine`.
- Plain bridge networking (v2+): the bundled Traefik publishes host 80/443;
  smoke-test with `curl -H 'Host: portal.example.com' http://localhost/` or the
  portal container's bridge IP directly.
- CI: `release-and-publish.yml` (push to main) gates on audit / typecheck /
  unit tests / secret scan / migration check, runs semantic-release, builds
  the image from the resulting HEAD, scans it with Trivy + Grype (fixable
  CRITICALs block), then pushes, so `:latest` always carries the
  just-released version
  (the baked version is read from package.json, bumped *before* the build)
  and never a gated image. `pr-checks.yml` runs the same pre-release gates on
  PRs, with no image build: builds stay serialised in the release workflow's
  concurrency group (the old ssh2/Turbopack ESM-chunk collision was two
  concurrent builds). A build may still retry on a transient Turbopack error;
  `:latest` is what `deploy.sh` pulls. Keep the shared step bodies of the two
  workflows in sync.

## Code conventions

- New `SystemSettings` field = lockstep edits in `prisma/schema.prisma` (+
  migration), `src/lib/useAdminSettings.ts`, `src/app/api/admin/settings/route.ts`,
  and the relevant settings page.
- Admin pages: async server component, `export const dynamic = "force-dynamic"`,
  try/catch around UniFi calls so the page renders (with an error banner) when
  the controller is unreachable. Follow `src/app/admin/clients/page.tsx`.
- Secrets in DB columns go through `encryptSecret`/`decryptSecret`
  (`src/lib/secrets.ts`, AES-256-GCM); never store new secrets plaintext.
- Admin mutations get an `audit(req, …)` entry (dot-namespaced action) and
  `requireAdmin(req, { settings: true })` gating for destructive actions.
- Sidebar nav lives in `src/app/admin/layout.tsx` (`navGroups`); pick an
  unused lucide icon and add it to the import line.

Local-only operational details (tokens, GitHub API quirks) are in
CLAUDE.local.md, which is intentionally not committed.
