const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGeneralCommentBody,
  findDuplicateAnchoredComment,
  findDuplicateGeneralComment,
  parseGitHubRemote,
  parsePrReference,
  postReviewComments,
} = require("./github.cjs");

test("parseGitHubRemote handles HTTPS remotes", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/example-org/example-repo.git"), {
    owner: "example-org",
    repo: "example-repo",
  });
});

test("parseGitHubRemote handles SSH remotes", () => {
  assert.deepEqual(parseGitHubRemote("git@github.com:example-org/example-repo.git"), {
    owner: "example-org",
    repo: "example-repo",
  });
});

test("parsePrReference handles PR URLs", () => {
  assert.deepEqual(
    parsePrReference("https://github.com/example-org/example-repo/pull/341", process.cwd()),
    {
      owner: "example-org",
      repo: "example-repo",
      number: 341,
    },
  );
});

test("findDuplicateAnchoredComment matches path, line, and body", () => {
  const existing = [
    { id: 1, path: "src/a.js", line: 12, body: "Same finding" },
    { id: 2, path: "src/a.js", line: 13, body: "Same finding" },
  ];

  assert.deepEqual(
    findDuplicateAnchoredComment(existing, {
      path: "src/a.js",
      line: 12,
      body: "Same finding",
    }),
    existing[0],
  );
  assert.equal(
    findDuplicateAnchoredComment(existing, {
      path: "src/a.js",
      line: 12,
      body: "Different finding",
    }),
    undefined,
  );
});

test("buildGeneralCommentBody uses a stable prefix", () => {
  assert.equal(
    buildGeneralCommentBody([{ body: "First" }, { body: "Second" }]),
    "[codex-pr-review]\n\nAI review follow-up items that could not be cleanly anchored to a single diff line:\n\n1. First\n2. Second",
  );
});

test("findDuplicateGeneralComment matches the complete generated body", () => {
  const body = buildGeneralCommentBody([{ body: "General finding" }]);
  const existing = [{ id: 8, body }, { id: 9, body: `${body}\nChanged` }];

  assert.deepEqual(findDuplicateGeneralComment(existing, body), existing[0]);
  assert.equal(findDuplicateGeneralComment(existing, `${body}\nNew`), undefined);
});

test("postReviewComments reads existing comments and skips exact duplicates", () => {
  const calls = [];
  const api = (args) => {
    calls.push(args);
    const endpoint = args.at(-1);
    if (endpoint.endsWith("/pulls/7")) return { head: { sha: "abc123" } };
    if (endpoint.includes("/pulls/7/comments")) {
      return [[{ id: 31, path: "src/a.js", line: 12, body: "Anchored" }]];
    }
    if (endpoint.includes("/issues/7/comments")) {
      return [[{
        id: 32,
        body: buildGeneralCommentBody([{ body: "General" }]),
      }]];
    }
    throw new Error(`Unexpected API call: ${args.join(" ")}`);
  };

  const result = postReviewComments(
    { owner: "org", repo: "repo", number: 7 },
    "/repo",
    [
      { path: "src/a.js", line: 12, body: "Anchored" },
      { body: "General" },
    ],
    { ensureAuth: () => {}, api },
  );

  assert.deepEqual(result, {
    reviewComments: [],
    issueComment: null,
    skipped: [
      { type: "anchored", reason: "duplicate", comment: { path: "src/a.js", line: 12, body: "Anchored" } },
      { type: "general", reason: "duplicate", body: buildGeneralCommentBody([{ body: "General" }]) },
    ],
  });
  assert.equal(calls.some((args) => args.includes("POST")), false);
});

test("postReviewComments posts only new comments and returns existing success fields", () => {
  const posted = [];
  const api = (args) => {
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args.includes("POST")) {
      posted.push(args);
      return endpoint.includes("/pulls/") ? { id: 41 } : { id: 42 };
    }
    if (endpoint.endsWith("/pulls/7")) return { head: { sha: "abc123" } };
    return [[]];
  };

  const result = postReviewComments(
    { owner: "org", repo: "repo", number: 7 },
    "/repo",
    [
      { path: "src/a.js", line: 12, body: "Anchored" },
      { body: "General" },
    ],
    { ensureAuth: () => {}, api },
  );

  assert.deepEqual(result, {
    reviewComments: [{ id: 41 }],
    issueComment: { id: 42 },
    skipped: [],
  });
  assert.equal(posted.length, 2);
  assert.ok(posted[1].includes(`body=${buildGeneralCommentBody([{ body: "General" }])}`));
});

test("postReviewComments retry skips comments already created by the first attempt", () => {
  const reviewComments = [];
  let postCount = 0;
  const api = (args) => {
    const endpoint = args.find((arg) => arg.startsWith("repos/"));
    if (args.includes("POST")) {
      postCount += 1;
      const created = { id: 51, path: "src/a.js", line: 12, body: "Anchored" };
      reviewComments.push(created);
      return created;
    }
    if (endpoint.endsWith("/pulls/7")) return { head: { sha: "abc123" } };
    if (endpoint.includes("/pulls/7/comments")) return [reviewComments.slice()];
    return [[]];
  };
  const ref = { owner: "org", repo: "repo", number: 7 };
  const comments = [{ path: "src/a.js", line: 12, body: "Anchored" }];
  const dependencies = { ensureAuth: () => {}, api };

  postReviewComments(ref, "/repo", comments, dependencies);
  const retry = postReviewComments(ref, "/repo", comments, dependencies);

  assert.equal(postCount, 1);
  assert.equal(retry.reviewComments.length, 0);
  assert.equal(retry.skipped[0].reason, "duplicate");
});
