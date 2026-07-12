#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REQUIRED_FILES = [
  "prepare-pr-review.cjs",
  "post-pr-review-comments.cjs",
  "config.cjs",
  "lib/github.cjs",
  "lib/knowledge.cjs",
  "lib/review-packet.cjs",
];

function readJson(file, label, errors) {
  if (!fs.existsSync(file)) {
    errors.push(`Missing ${label}: ${file}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`Invalid ${label}: ${error.message}`);
    return null;
  }
}

function readSkill(file, label, errors) {
  if (!fs.existsSync(file)) {
    errors.push(`Missing ${label}: ${file}`);
    return null;
  }

  const contents = fs.readFileSync(file, "utf8");
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`Invalid ${label} frontmatter: expected opening and closing ---`);
    return null;
  }

  const name = match[1].match(/^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]?.trim();
  const metadata = match[1].match(/^metadata:\s*\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m)?.[1] || "";
  const version = metadata.match(/^\s+version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1];
  if (!name || !version) {
    errors.push(`Invalid ${label} frontmatter: name and metadata.version are required`);
    return null;
  }
  return { name, version, path: file };
}

function requireFields(value, fields, label, errors) {
  for (const field of fields) {
    if (typeof value?.[field] !== "string" || value[field].trim() === "") {
      errors.push(`${label} requires ${field}`);
    }
  }
}

function isPathInside(root, candidate) {
  const canonicalRoot = fs.realpathSync(root);
  const resolvedCandidate = path.resolve(candidate);
  const canonicalCandidate = fs.existsSync(resolvedCandidate)
    ? fs.realpathSync(resolvedCandidate)
    : resolvedCandidate;
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function verifyPackage(pluginDir) {
  const root = path.resolve(pluginDir);
  const errors = [];
  const plugin = readJson(path.join(root, ".codex-plugin/plugin.json"), "plugin manifest", errors);
  const marketplace = readJson(
    path.join(root, ".codex-plugin/marketplace.json"),
    "marketplace manifest",
    errors,
  );

  if (plugin) requireFields(plugin, ["name", "version", "skills"], "Plugin manifest", errors);

  let skill = null;
  if (plugin?.skills) {
    const skillsDir = path.resolve(root, plugin.skills);
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
      errors.push(`Manifest skills path does not exist: ${plugin.skills}`);
    } else {
      skill = readSkill(path.join(skillsDir, "pr-review-agent/SKILL.md"), "package skill", errors);
    }
  } else if (plugin) {
    errors.push("Plugin manifest must declare a skills path");
  }

  for (const relativePath of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      errors.push(`Missing required file: ${relativePath}`);
    }
  }

  const marketplacePlugin = marketplace?.plugins?.find((item) => item.name === plugin?.name)
    || marketplace?.plugins?.[0];
  if (marketplace && !marketplacePlugin) {
    errors.push("Marketplace manifest does not declare the plugin");
  } else if (marketplacePlugin) {
    requireFields(
      marketplacePlugin,
      ["name", "version", "source"],
      "Marketplace plugin",
      errors,
    );
    if (marketplacePlugin.source && marketplacePlugin.source !== "./") {
      errors.push('Marketplace plugin source must be "./"');
    }
    if (plugin?.name && marketplacePlugin.name && marketplacePlugin.name !== plugin.name) {
      errors.push(`Marketplace plugin name mismatch: expected ${plugin.name}`);
    }
  }

  const versions = [plugin?.version, marketplacePlugin?.version, skill?.version].filter(Boolean);
  if (versions.length > 1 && new Set(versions).size !== 1) {
    errors.push(`Package version mismatch: ${versions.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    root,
    name: plugin?.name || null,
    version: plugin?.version || null,
    skill,
    errors,
  };
}

function defaultProbeCodex() {
  const versionRun = spawnSync("codex", ["--version"], { encoding: "utf8" });
  if (versionRun.error || versionRun.status !== 0) {
    return {
      available: false,
      error: versionRun.error?.message || versionRun.stderr.trim() || "codex --version failed",
    };
  }

  const marketplaceRun = spawnSync("codex", ["plugin", "marketplace", "--help"], {
    encoding: "utf8",
  });
  return {
    available: true,
    version: versionRun.stdout.trim() || versionRun.stderr.trim(),
    marketplaceCapability: marketplaceRun.status === 0,
  };
}

function verifyInstall({ pluginDir, activeSkillPath, probeCodex = defaultProbeCodex }) {
  const packageResult = verifyPackage(pluginDir);
  const result = {
    status: "BLOCKED",
    package: packageResult,
    activeSkill: null,
    codex: null,
    errors: [...packageResult.errors],
    guidance: [],
  };

  if (!packageResult.valid) return result;

  result.codex = probeCodex();
  if (!result.codex?.available) {
    result.errors.push(`Codex CLI unavailable: ${result.codex?.error || "unknown error"}`);
  } else {
    if (!result.codex.version?.trim()) {
      result.errors.push("Codex CLI version is unavailable");
    }
    if (!result.codex.marketplaceCapability) {
      result.errors.push("Codex CLI does not support plugin marketplace capability");
    }
  }

  if (result.errors.length > 0) return result;

  if (!activeSkillPath) {
    result.status = "PACKAGE_ONLY";
    result.guidance.push("Provide the activated skill explicitly with --active-skill <path>.");
    return result;
  }

  if (isPathInside(packageResult.root, activeSkillPath)) {
    result.errors.push("Active skill path must not be inside pluginDir");
    return result;
  }

  const activeErrors = [];
  result.activeSkill = readSkill(path.resolve(activeSkillPath), "active skill", activeErrors);
  result.errors.push(...activeErrors);

  if (
    result.activeSkill
    && result.activeSkill.name !== packageResult.skill.name
  ) {
    result.errors.push(
      `Active skill name mismatch: expected ${packageResult.skill.name}, got ${result.activeSkill.name}`,
    );
  }

  if (
    result.activeSkill
    && result.activeSkill.version !== packageResult.version
  ) {
    result.errors.push(
      `Active skill version mismatch: expected ${packageResult.version}, got ${result.activeSkill.version}`,
    );
  }

  if (result.errors.length === 0) {
    result.status = "READY";
    result.guidance.push("READY confirms explicit activated skill verification at the supplied path.");
  }
  return result;
}

function parseArgs(argv) {
  const options = { pluginDir: ".", json: false };
  function readPathValue(option, index) {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${option} requires a path`);
    return value;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plugin-dir") options.pluginDir = readPathValue(argument, index++);
    else if (argument === "--active-skill") options.activeSkillPath = readPathValue(argument, index++);
    else if (argument === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const result = verifyInstall(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.status}\n`);
    for (const error of result.errors) process.stdout.write(`- ${error}\n`);
    for (const guidance of result.guidance) process.stdout.write(`- ${guidance}\n`);
  }
  return result.status === "BLOCKED" ? 1 : 0;
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  defaultProbeCodex,
  parseArgs,
  readSkill,
  runCli,
  verifyInstall,
  verifyPackage,
};
