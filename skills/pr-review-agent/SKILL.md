---
name: pr-review-agent
description: Review a GitHub PR using project-supplied review knowledge, then optionally post comments back to the PR. Runs in whichever agent invokes it (Claude Code or Codex).
license: MIT
metadata:
  author: Amber-Chang
  version: "0.1.0"
---

Use this skill when the user pastes a GitHub PR URL or asks for a review of a PR
from the current repository context.

`<plugin-dir>` below means the directory that contains this plugin's
`plugin.json` (the install location of the `codex-pr-review` plugin). Run the
scripts from inside the repository you are reviewing so they can detect the repo
root and the project's review config.

## Goal

Turn a pasted PR URL or PR number into a repeatable PR review flow:

1. Load the project's own review knowledge from repo files (via the project's
   `.codex/review-config.json`; see README)
2. Read the PR diff and changed files through `gh`
3. Review the PR against SPEC / PRD / module docs / code-quality rules
4. Optionally post confirmed comments back to GitHub

## Workflow

### 1. Prepare the review packet

Before reviewing, verify the plugin package is complete, `gh auth` is valid,
the requested PR can be read, and all knowledge required by the project's
review config loaded successfully. If any check fails, stop with
`PR REVIEW BLOCKED`; do not downgrade to an ungrounded diff-only pass.

Run (from the repo you are reviewing):

```bash
node <plugin-dir>/prepare-pr-review.cjs <pr-url-or-number> --write /tmp/pr-review-packet.json
```

If `gh` auth is invalid, stop and tell the user they need to re-authenticate
before the review agent can read or comment on the PR.

If the project has no `.codex/review-config.json`, state that the review has no
project-specific knowledge. If the repository or request requires that
knowledge, stop with `PR REVIEW BLOCKED`.

### 2. Review posture

- Read the packet summary first
- Read any suggested module docs and relevant SPEC / PRD files before judging
  behavior
- Findings come before summary
- Prioritize:
  - SPEC / contract drift
  - privacy / RBAC / audit issues
  - missing tests
  - false confidence where code "works" but does not match the contract

### 3. Output shape

Use:

```text
PR PASS / PR FAIL / PR REVIEW BLOCKED
```

- `PR PASS`: the review packet and cited review evidence support no actionable
  findings.
- `PR FAIL`: the packet and evidence support one or more actionable findings.
- `PR REVIEW BLOCKED`: the plugin, `gh auth`, PR access, or required knowledge
  could not be verified. Never report `PR PASS` from an incomplete review.

Then list findings by severity with:
- violated rule / contract
- concrete file path
- behavioral risk
- whether it should be posted as a GitHub comment

### 4. Post comments when explicitly authorized

Post direct PR comments only after explicit user authorization. Authorization
for one PR does not carry over to another PR or session.

1. Convert confirmed findings into JSON
2. Save it to a temp file
3. Run:

```bash
node <plugin-dir>/post-pr-review-comments.cjs <pr-url-or-number> --input /tmp/pr-comments.json
```

Comment rules:
- Post line comments only when you have a clear `path` + `line`
- Move non-anchorable findings into a general PR comment
- Do not post speculative or low-confidence comments
- Do not post style-only comments unless they violate a documented project rule
  or pattern
