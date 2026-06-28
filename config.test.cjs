const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadConfig } = require("./config.cjs");

test("loadConfig returns safe defaults when no review-config.json exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-noconfig-"));
  const config = loadConfig({ root });
  assert.equal(config.ROOT, root);
  assert.deepEqual(config.knowledgeSources, []);
  assert.deepEqual(config.moduleDocHints, []);
  assert.equal(config.errorPatternsPath, null);
});

test("loadConfig reads consumer config from <root>/.codex/review-config.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-config-"));
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".codex", "review-config.json"),
    JSON.stringify({
      knowledgeSources: [
        { id: "guide", title: "Guide", path: "docs/guide.md", kind: "guide" },
      ],
      moduleDocHints: [{ prefix: "src/auth/", doc: "docs/auth.md" }],
      errorPatternsPath: ".codex/error-patterns.json",
    }),
  );

  const config = loadConfig({ root });
  assert.equal(config.knowledgeSources.length, 1);
  assert.equal(config.knowledgeSources[0].id, "guide");
  assert.equal(config.moduleDocHints[0].prefix, "src/auth/");
  assert.equal(config.errorPatternsPath, ".codex/error-patterns.json");
});

test("loadConfig falls back to safe defaults when config JSON is malformed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-bad-"));
  fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex", "review-config.json"), "{ not valid json");

  const config = loadConfig({ root });
  assert.deepEqual(config.knowledgeSources, []);
  assert.deepEqual(config.moduleDocHints, []);
  assert.equal(config.errorPatternsPath, null);
});
