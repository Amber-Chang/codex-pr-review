const { execFileSync } = require("child_process");

function exec(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
      input: options.input,
    });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    const detail = stderr || stdout || error.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function ensureGhAuth(cwd) {
  try {
    exec("gh", ["auth", "status"], { cwd });
  } catch (error) {
    throw new Error(
      "GitHub CLI authentication is invalid. Run `gh auth login -h github.com` before reading or commenting on PRs.",
    );
  }
}

function parseGitHubRemote(remoteUrl) {
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!sshMatch) {
    throw new Error(`Unable to parse GitHub remote URL: ${remoteUrl}`);
  }

  return {
    owner: sshMatch[1],
    repo: sshMatch[2],
  };
}

function getOriginRepo(cwd) {
  const remoteUrl = exec("git", ["remote", "get-url", "origin"], { cwd }).trim();
  return parseGitHubRemote(remoteUrl);
}

function parsePrReference(input, cwd) {
  if (!input) {
    throw new Error("Missing PR reference. Pass a PR URL or number.");
  }

  const value = String(input).trim();
  const urlMatch = value.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i,
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: Number(urlMatch[3]),
    };
  }

  if (/^\d+$/.test(value)) {
    const origin = getOriginRepo(cwd);
    return {
      owner: origin.owner,
      repo: origin.repo,
      number: Number(value),
    };
  }

  throw new Error(`Unsupported PR reference: ${input}`);
}

function ghJson(args, cwd) {
  const raw = exec("gh", args, { cwd });
  return JSON.parse(raw);
}

function readPr(ref, cwd) {
  ensureGhAuth(cwd);
  const pullRequest = ghJson(
    ["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`],
    cwd,
  );
  const pages = ghJson(
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
    ],
    cwd,
  );
  const files = pages.flat();
  return {
    ref,
    pullRequest,
    files,
  };
}

function flattenPages(value) {
  if (!Array.isArray(value)) return [];
  return value.flat();
}

function findDuplicateAnchoredComment(existingComments, comment) {
  return existingComments.find(
    (existing) =>
      existing.path === comment.path &&
      existing.line === comment.line &&
      existing.body === comment.body,
  );
}

function buildGeneralCommentBody(comments) {
  return [
    "[codex-pr-review]",
    "",
    "AI review follow-up items that could not be cleanly anchored to a single diff line:",
    "",
    ...comments.map((comment, index) => `${index + 1}. ${comment.body}`),
  ].join("\n");
}

function findDuplicateGeneralComment(existingComments, body) {
  return existingComments.find((existing) => existing.body === body);
}

function postReviewComments(ref, cwd, comments, dependencies = {}) {
  const ensureAuth = dependencies.ensureAuth || ensureGhAuth;
  const api = dependencies.api || ((args) => ghJson(args, cwd));

  ensureAuth(cwd);
  if (!Array.isArray(comments) || comments.length === 0) {
    return {
      reviewComments: [],
      issueComment: null,
      skipped: [],
    };
  }

  const anchored = comments.filter((comment) => comment.path && Number.isInteger(comment.line));
  const unanchored = comments.filter((comment) => !(comment.path && Number.isInteger(comment.line)));
  const existingReviewComments = flattenPages(
    api([
      "api",
      "--paginate",
      "--slurp",
      `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments?per_page=100`,
    ]),
  );
  const existingIssueComments = flattenPages(
    api([
      "api",
      "--paginate",
      "--slurp",
      `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=100`,
    ]),
  );
  const skipped = [];
  const newAnchored = anchored.filter((comment) => {
    if (!findDuplicateAnchoredComment(existingReviewComments, comment)) return true;
    skipped.push({ type: "anchored", reason: "duplicate", comment });
    return false;
  });

  let pr = null;
  if (newAnchored.length > 0) {
    pr = api(["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`]);
  }

  const reviewComments = newAnchored.map((comment) => {
    return api(
      [
        "api",
        "--method",
        "POST",
        `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`,
        "-f",
        `body=${comment.body}`,
        "-f",
        `commit_id=${pr.head.sha}`,
        "-f",
        `path=${comment.path}`,
        "-F",
        `line=${comment.line}`,
        "-f",
        `side=${comment.side || "RIGHT"}`,
      ],
    );
  });

  let issueComment = null;
  if (unanchored.length > 0) {
    const body = buildGeneralCommentBody(unanchored);
    if (findDuplicateGeneralComment(existingIssueComments, body)) {
      skipped.push({ type: "general", reason: "duplicate", body });
    } else {
      issueComment = api([
        "api",
        "--method",
        "POST",
        `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`,
        "-f",
        `body=${body}`,
      ]);
    }
  }

  return {
    reviewComments,
    issueComment,
    skipped,
  };
}

module.exports = {
  buildGeneralCommentBody,
  ensureGhAuth,
  findDuplicateAnchoredComment,
  findDuplicateGeneralComment,
  getOriginRepo,
  parseGitHubRemote,
  parsePrReference,
  postReviewComments,
  readPr,
};
