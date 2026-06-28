const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { addErrorPattern, loadKnowledge, searchKnowledge, summarizeMarkdown } = require("./knowledge.cjs");

test("summarizeMarkdown extracts headings and bullets", () => {
  const summary = summarizeMarkdown(`# Title

- First bullet
- Second bullet
`);
  assert.deepEqual(summary.slice(0, 2), [
    "Title: First bullet",
    "Title: Second bullet",
  ]);
});

test("loadKnowledge and searchKnowledge work with repo-backed files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-knowledge-"));
  fs.mkdirSync(path.join(tempRoot, "docs"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "docs", "guide.md"), "# Guide\n- review busy wait\n");
  fs.writeFileSync(
    path.join(tempRoot, "patterns.json"),
    JSON.stringify({
      patterns: [
        {
          id: "busy-wait",
          title: "Busy wait loop",
          summary: "Polling with sleep instead of using blocking primitives.",
          tags: ["go", "lock"],
        },
      ],
    }),
  );

  const knowledge = loadKnowledge({
    root: tempRoot,
    knowledgeSources: [
      {
        id: "guide",
        title: "Guide",
        path: "docs/guide.md",
        kind: "guide",
      },
    ],
    errorPatternsPath: "patterns.json",
  });

  const matches = searchKnowledge(knowledge, "busy wait lock");
  assert.equal(matches[0].title, "Guide");
  assert.equal(matches[1].title, "Busy wait loop");
});

test("addErrorPattern writes new pattern to store", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-review-patterns-"));
  fs.writeFileSync(path.join(tempRoot, "patterns.json"), JSON.stringify({ patterns: [] }));

  const added = addErrorPattern(
    { root: tempRoot, errorPatternsPath: "patterns.json" },
    {
      title: "Missing roundtrip test",
      summary: "Cross-layer contract changed without integration coverage.",
    },
  );

  const stored = JSON.parse(fs.readFileSync(path.join(tempRoot, "patterns.json"), "utf8"));
  assert.equal(stored.patterns[0].title, added.title);
});

test("addErrorPattern throws when errorPatternsPath is not configured", () => {
  assert.throws(
    () => addErrorPattern({ root: "/tmp", errorPatternsPath: null }, { title: "x", summary: "y" }),
    /addErrorPattern requires errorPatternsPath to be configured\./,
  );
});
