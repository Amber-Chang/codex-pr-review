const test = require("node:test");
const assert = require("node:assert/strict");

const { parseGitHubRemote, parsePrReference } = require("./github.cjs");

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
