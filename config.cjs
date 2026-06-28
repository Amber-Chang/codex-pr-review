// [AI-ASSISTED] by PM Amber (via AI Agent), 2026-06-29
// Purpose: Generic config loader — the consuming project supplies its own review
// knowledge via <repo-root>/.codex/review-config.json; missing/broken config
// falls back to safe defaults so the plugin never crashes.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_CONFIG_RELATIVE_PATH = ".codex/review-config.json";

// Walk up from startDir to locate the consuming repository root. Prefer git,
// then look for a directory holding .git or the review-config; finally fall
// back to startDir so a non-git checkout still works.
function findRepoRoot(startDir) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (top) {
      return top;
    }
  } catch (_error) {
    // Not a git checkout (or git missing) — fall through to manual walk.
  }

  let dir = path.resolve(startDir);
  for (;;) {
    if (
      fs.existsSync(path.join(dir, ".git")) ||
      fs.existsSync(path.join(dir, DEFAULT_CONFIG_RELATIVE_PATH))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return path.resolve(startDir);
}

function safeDefaults(root) {
  return {
    ROOT: root,
    configPath: null,
    knowledgeSources: [],
    moduleDocHints: [],
    errorPatternsPath: null,
  };
}

// loadConfig({ root?, cwd?, configPath? }) -> resolved config object.
// - root: repository root (relative knowledge paths resolve against this).
//   When omitted it is auto-detected from cwd.
// - configPath: override the conventional config location (relative to root).
function loadConfig(options = {}) {
  const startDir = options.cwd || process.cwd();
  const root = options.root || findRepoRoot(startDir);
  const configRelative = options.configPath || DEFAULT_CONFIG_RELATIVE_PATH;
  const configAbsolute = path.resolve(root, configRelative);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configAbsolute, "utf8"));
  } catch (_error) {
    // One catch covers both cases: a missing config file (ENOENT from
    // readFileSync) and malformed JSON (SyntaxError) — both fall back to safe
    // defaults so the plugin never crashes. Reading directly without an
    // existsSync precheck also avoids a TOCTOU race.
    return safeDefaults(root);
  }

  return {
    ROOT: root,
    configPath: configAbsolute,
    knowledgeSources: Array.isArray(parsed.knowledgeSources) ? parsed.knowledgeSources : [],
    moduleDocHints: Array.isArray(parsed.moduleDocHints) ? parsed.moduleDocHints : [],
    errorPatternsPath:
      typeof parsed.errorPatternsPath === "string" && parsed.errorPatternsPath
        ? parsed.errorPatternsPath
        : null,
  };
}

module.exports = {
  DEFAULT_CONFIG_RELATIVE_PATH,
  findRepoRoot,
  loadConfig,
};
