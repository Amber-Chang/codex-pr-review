---
name: pr-review-agent
description: Review a GitHub PR from Codex using project-supplied review knowledge, then optionally post comments back to the PR.
license: MIT
metadata:
  author: Amber-Chang
  version: "0.1.0"
---

Use this skill when the user pastes a GitHub PR URL or asks Codex to review a PR
from the current repository context.

`<plugin-dir>` below means the directory that contains this plugin's
`plugin.json` (the install location of the `codex-pr-review` plugin). Run the
scripts from inside the repository you are reviewing so they can detect the repo
root and the project's review config.

## Goal

Turn a pasted PR URL or PR number into a repeatable Codex review flow:

1. Load the project's own review knowledge from repo files (via the project's
   `.codex/review-config.json`; see README)
2. Read the PR diff and changed files through `gh`
3. Review the PR against SPEC / PRD / module docs / code-quality rules
4. Optionally post confirmed comments back to GitHub

## Workflow

### 1. Prepare the review packet

Run (from the repo you are reviewing):

```bash
node <plugin-dir>/prepare-pr-review.cjs <pr-url-or-number> --write /tmp/pr-review-packet.json
```

If `gh` auth is invalid, stop and tell the user they need to re-authenticate
before Codex can read or comment on the PR.

If the project has no `.codex/review-config.json`, the packet still builds with
empty knowledge — review proceeds on the diff alone.

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
Overall: PASS / NEEDS_CHANGES / NEEDS_REDESIGN
```

Then list findings by severity with:
- violated rule / contract
- concrete file path
- behavioral risk
- whether it should be posted as a GitHub comment

### 4. Post comments when requested

When the user wants direct PR comments:

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
