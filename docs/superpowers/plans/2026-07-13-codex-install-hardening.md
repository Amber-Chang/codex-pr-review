# Codex Install Hardening Implementation Plan

> **For Codex:** Execute task-by-task with test-first changes, then run the live review only after all local gates pass.

**Goal:** Make the plugin's Codex installation state verifiable, enforce a fail-closed PR review contract, prevent duplicate GitHub comments, and validate the complete flow against `Amber-Chang/builder-pm#7`.

**Architecture:** Keep the existing Claude Code manifests and review-packet engine unchanged. Add a standalone verifier around the package/active-skill boundary, strengthen the shared skill documentation contract, and add deduplication inside the existing GitHub posting adapter so every caller benefits.

**Tech Stack:** Node.js CommonJS, `node:test`, GitHub CLI (`gh`), Codex CLI.

---

## Task 1: Add package contract tests

**Files:**
- Create: `scripts/package-contract.test.cjs`
- Modify: `skills/pr-review-agent/SKILL.md`
- Modify: `README.md`

1. Write failing tests that parse both Codex manifests and the skill frontmatter.
2. Assert manifest/skill versions match, the new `PR PASS / PR FAIL / PR REVIEW BLOCKED` contract exists, and the old `Overall:` enum is absent.
3. Assert README describes the public repository and never documents `codex plugin install`.
4. Run the new test and confirm it fails for the expected old documentation.
5. Update the skill contract and README with the minimum changes needed to pass.
6. Run the focused test and full `node --test` suite.
7. Commit the contract/documentation change.

## Task 2: Build the Codex installation verifier

**Files:**
- Create: `scripts/verify-codex-install.cjs`
- Create: `scripts/verify-codex-install.test.cjs`

1. Write failing tests for `READY`, `PACKAGE_ONLY`, and `BLOCKED` using temporary package fixtures and injected CLI probes.
2. Cover missing manifests/scripts, mismatched versions, malformed frontmatter, unavailable Codex CLI, missing marketplace capability, active-skill mismatch, and JSON output.
3. Implement exported verification functions plus the CLI entry point.
4. Keep active skill discovery explicit through `--active-skill`; do not write or symlink into Codex private directories.
5. Run focused verifier tests and the full suite.
6. Manually run package-only and JSON verification against the real repository.
7. Commit the verifier.

## Task 3: Prevent duplicate PR comments

**Files:**
- Modify: `lib/github.cjs`
- Modify: `lib/github.test.cjs`
- Modify: `post-pr-review-comments.cjs` only if CLI validation needs adjustment

1. Write failing tests around pure comment identity/deduplication helpers.
2. Define anchored identity as `path + line + body`; define general identity through a stable `[codex-pr-review]` body prefix and exact body match.
3. Read existing review comments and issue comments before posting.
4. Skip existing comments and return explicit skipped results; post only new comments.
5. Preserve current API shape for successful posts and avoid changing prepare behavior.
6. Run focused GitHub tests and full suite.
7. Commit deduplication.

## Task 4: Validate the local package and active-skill boundary

**Files:**
- Modify: `README.md` only if real CLI output exposes a documentation mismatch

1. Run the verifier without `--active-skill`; expect `PACKAGE_ONLY` with actionable guidance.
2. Check `codex --version` and `codex plugin marketplace --help` through the verifier.
3. Locate an active skill only through an explicit known path or official activation result.
4. If no active skill is available, report `PACKAGE_ONLY` rather than treating direct script execution as plugin activation.
5. If README needs correction based on observed CLI behavior, add a failing contract assertion before editing.

## Task 5: Run the live review against builder-pm PR #7

**Files:**
- Runtime artifacts only: `/tmp/builder-pm-pr-7-packet.json`, `/tmp/builder-pm-pr-7-comments.json`

1. Verify `gh auth status` and confirm PR #7 remains open.
2. Run the package verifier and record whether the environment is `READY` or `PACKAGE_ONLY`.
3. Generate the review packet from the builder-pm repository using this worktree's prepare script.
4. Validate packet metadata, changed files, diff content, and required knowledge sources.
5. Review findings against the approved skill contract.
6. Post only authorized, high-confidence, behavior-risk findings with valid anchors; otherwise record `PR PASS` and post nothing.
7. Read GitHub comments back and verify count/content; rerun posting input when applicable to prove deduplication.
8. Do not approve, merge, or modify builder-pm.

## Task 6: Final verification and publication

**Files:**
- Modify: design/plan status text only if needed to reflect completion evidence

1. Run `node --test` from a clean worktree state.
2. Run verifier smoke tests and inspect `git diff --check`.
3. Request an independent code review of the complete branch and address valid findings.
4. Confirm commits contain only codex-pr-review changes and no generated secrets/runtime artifacts.
5. Push `codex/install-hardening` to origin.
6. Open a ready-for-review PR with test results, verifier status, live-review evidence, and explicit note that Claude Code logic was preserved.
