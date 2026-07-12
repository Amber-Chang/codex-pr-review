const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { verifyInstall } = require("./verify-codex-install.cjs");

const VERSION = "1.2.3";

function writeFile(root, relativePath, contents = "module.exports = {};\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function updateJson(root, relativePath, update) {
  const target = path.join(root, relativePath);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  update(value);
  fs.writeFileSync(target, JSON.stringify(value));
}

function createPackage(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-install-package-"));
  const pluginVersion = overrides.pluginVersion || VERSION;
  const marketplaceVersion = overrides.marketplaceVersion || VERSION;
  const skillVersion = overrides.skillVersion || VERSION;

  writeFile(root, ".codex-plugin/plugin.json", JSON.stringify({
    name: "codex-pr-review",
    version: pluginVersion,
    skills: "./skills/",
  }));
  writeFile(root, ".codex-plugin/marketplace.json", JSON.stringify({
    name: "codex-pr-review",
    plugins: [{ name: "codex-pr-review", version: marketplaceVersion, source: "./" }],
  }));
  writeFile(root, "skills/pr-review-agent/SKILL.md", overrides.skillContents || `---\nname: pr-review-agent\nmetadata:\n  version: "${skillVersion}"\n---\n\nReview a PR.\n`);

  for (const file of [
    "prepare-pr-review.cjs",
    "post-pr-review-comments.cjs",
    "config.cjs",
    "lib/github.cjs",
    "lib/knowledge.cjs",
    "lib/review-packet.cjs",
  ]) {
    writeFile(root, file);
  }

  if (overrides.remove) fs.rmSync(path.join(root, overrides.remove));
  return root;
}

function activeSkill(version = VERSION, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-active-skill-"));
  return writeFile(root, "SKILL.md", contents || `---\nname: pr-review-agent\nmetadata:\n  version: "${version}"\n---\n`);
}

function capableCli() {
  return {
    available: true,
    version: "codex-cli 0.125.0",
    marketplaceCapability: true,
  };
}

test("returns PACKAGE_ONLY when the package is valid but no active skill is explicit", () => {
  const result = verifyInstall({ pluginDir: createPackage(), probeCodex: capableCli });

  assert.equal(result.status, "PACKAGE_ONLY");
  assert.equal(result.package.valid, true);
  assert.match(result.guidance.join("\n"), /--active-skill/);
});

test("returns BLOCKED when lib/review-packet.cjs is missing", () => {
  const result = verifyInstall({
    pluginDir: createPackage({ remove: "lib/review-packet.cjs" }),
    probeCodex: capableCli,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /lib\/review-packet\.cjs/);
});

test("returns READY when package, explicit active skill, and Codex capability match", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    activeSkillPath: activeSkill(),
    probeCodex: capableCli,
  });

  assert.equal(result.status, "READY");
  assert.equal(result.package.version, VERSION);
  assert.equal(result.activeSkill.version, VERSION);
  assert.equal(result.codex.marketplaceCapability, true);
  assert.deepEqual(result.errors, []);
  assert.match(result.guidance.join("\n"), /explicit activated skill verification/i);
});

test("returns BLOCKED when active skill points anywhere inside pluginDir", () => {
  const pluginDir = createPackage();
  const result = verifyInstall({
    pluginDir,
    activeSkillPath: path.join(pluginDir, "skills/pr-review-agent/SKILL.md"),
    probeCodex: capableCli,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /inside pluginDir/i);
});

test("returns BLOCKED when an external symlink points to the package skill", () => {
  const pluginDir = createPackage();
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-active-skill-link-"));
  const linkPath = path.join(linkRoot, "SKILL.md");
  fs.symlinkSync(path.join(pluginDir, "skills/pr-review-agent/SKILL.md"), linkPath);

  const result = verifyInstall({
    pluginDir,
    activeSkillPath: linkPath,
    probeCodex: capableCli,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /inside pluginDir/i);
});

test("returns BLOCKED and names a missing required package file", () => {
  const result = verifyInstall({
    pluginDir: createPackage({ remove: "lib/github.cjs" }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /lib\/github\.cjs/);
});

test("returns BLOCKED when manifest and skill versions differ", () => {
  const result = verifyInstall({
    pluginDir: createPackage({ marketplaceVersion: "9.9.9" }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /version/i);
});

test("returns BLOCKED when required plugin manifest fields are missing", () => {
  for (const field of ["name", "version", "skills"]) {
    const pluginDir = createPackage();
    updateJson(pluginDir, ".codex-plugin/plugin.json", (manifest) => delete manifest[field]);

    const result = verifyInstall({ pluginDir, probeCodex: capableCli });

    assert.equal(result.status, "BLOCKED", field);
    assert.match(result.errors.join("\n"), new RegExp(`plugin manifest.*${field}`, "i"));
  }
});

test("returns BLOCKED when required marketplace plugin fields are missing", () => {
  for (const field of ["name", "version", "source"]) {
    const pluginDir = createPackage();
    updateJson(pluginDir, ".codex-plugin/marketplace.json", (manifest) => {
      delete manifest.plugins[0][field];
    });

    const result = verifyInstall({ pluginDir, probeCodex: capableCli });

    assert.equal(result.status, "BLOCKED", field);
    assert.match(result.errors.join("\n"), new RegExp(`marketplace plugin.*${field}`, "i"));
  }
});

test("returns BLOCKED when marketplace plugin source is not ./", () => {
  const pluginDir = createPackage();
  updateJson(pluginDir, ".codex-plugin/marketplace.json", (manifest) => {
    manifest.plugins[0].source = "../plugin";
  });

  const result = verifyInstall({ pluginDir, probeCodex: capableCli });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /marketplace plugin.*source.*\.\//i);
});

test("returns BLOCKED for malformed skill frontmatter", () => {
  const result = verifyInstall({
    pluginDir: createPackage({ skillContents: "# Missing frontmatter\n" }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /frontmatter/i);
});

test("returns BLOCKED when Codex CLI is unavailable for active verification", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    activeSkillPath: activeSkill(),
    probeCodex: () => ({ available: false, error: "codex not found" }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /Codex CLI/i);
});

test("returns BLOCKED without an active skill when Codex CLI is unavailable", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    probeCodex: () => ({ available: false, error: "codex not found" }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /Codex CLI/i);
});

test("returns BLOCKED without an active skill when Codex version is unavailable", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    probeCodex: () => ({ available: true, version: "", marketplaceCapability: true }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /version/i);
});

test("returns BLOCKED when Codex lacks plugin marketplace capability", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    activeSkillPath: activeSkill(),
    probeCodex: () => ({
      available: true,
      version: "codex-cli 0.1.0",
      marketplaceCapability: false,
    }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /marketplace/i);
});

test("returns BLOCKED without an active skill when marketplace capability is missing", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    probeCodex: () => ({
      available: true,
      version: "codex-cli 0.1.0",
      marketplaceCapability: false,
    }),
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /marketplace/i);
});

test("returns BLOCKED when explicit active skill version differs", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    activeSkillPath: activeSkill("2.0.0"),
    probeCodex: capableCli,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /active skill version/i);
});

test("returns BLOCKED when explicit active skill name differs at the same version", () => {
  const result = verifyInstall({
    pluginDir: createPackage(),
    activeSkillPath: activeSkill(VERSION, `---\nname: another-review-agent\nmetadata:\n  version: "${VERSION}"\n---\n`),
    probeCodex: capableCli,
  });

  assert.equal(result.status, "BLOCKED");
  assert.match(result.errors.join("\n"), /active skill name/i);
});

test("CLI --json emits machine-readable PACKAGE_ONLY output", () => {
  const pluginDir = createPackage();
  const cli = path.join(__dirname, "verify-codex-install.cjs");
  const run = spawnSync(process.execPath, [cli, "--plugin-dir", pluginDir, "--json"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, "PACKAGE_ONLY");
  assert.equal(result.package.valid, true);
});

test("CLI exits 2 when a path option has no value or another option follows", () => {
  const cli = path.join(__dirname, "verify-codex-install.cjs");
  for (const args of [
    ["--plugin-dir"],
    ["--plugin-dir", "--json"],
    ["--active-skill"],
    ["--active-skill", "--json"],
  ]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

    assert.equal(run.status, 2, args.join(" "));
    assert.match(run.stderr, /requires a path/i);
  }
});
