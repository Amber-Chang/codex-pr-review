const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Codex manifests and review skill expose the same package version", () => {
  const plugin = JSON.parse(read(".codex-plugin/plugin.json"));
  const marketplace = JSON.parse(read(".codex-plugin/marketplace.json"));
  const skill = read("skills/pr-review-agent/SKILL.md");
  const skillVersion = skill.match(/version:\s*["']?([^"'\n]+)["']?/u)?.[1].trim();

  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.equal(skillVersion, plugin.version);
});

test("review skill uses fail-closed PR result statuses", () => {
  const skill = read("skills/pr-review-agent/SKILL.md");

  assert.match(skill, /PR PASS/);
  assert.match(skill, /PR FAIL/);
  assert.match(skill, /PR REVIEW BLOCKED/);
  assert.doesNotMatch(skill, /Overall:\s*PASS\s*\/\s*NEEDS_CHANGES\s*\/\s*NEEDS_REDESIGN/);
  assert.match(skill, /PR REVIEW BLOCKED[\s\S]*plugin[\s\S]*gh auth[\s\S]*PR[\s\S]*knowledge/i);
  assert.match(skill, /PR PASS[\s\S]*packet[\s\S]*(evidence|證據)/i);
});

test("review skill posts comments only after explicit authorization", () => {
  const skill = read("skills/pr-review-agent/SKILL.md");

  assert.match(skill, /(explicit|明確)[^\n]*(authoriz|授權)/i);
  assert.doesNotMatch(skill, /builder-pm[^\n]*#?7/i);
});

test("README documents public access and truthful Codex activation states", () => {
  const readme = read("README.md");

  assert.match(readme, /(public|公開)/i);
  assert.doesNotMatch(readme, /private repo/i);
  assert.doesNotMatch(readme, /codex plugin install/i);
  assert.match(readme, /marketplace registered/i);
  assert.match(readme, /plugin active/i);
  assert.match(readme, /skill verified/i);
  assert.match(readme, /READY/);
  assert.match(readme, /PACKAGE_ONLY/);
  assert.match(readme, /BLOCKED/);
});

test("README uses only the official activation result for the active skill path", () => {
  const readme = read("README.md");

  assert.doesNotMatch(readme, /~\/\.codex\/\.tmp\/marketplaces/u);
  assert.doesNotMatch(readme, /~\/\.codex\/skills/u);
  assert.match(readme, /--active-skill <official-active-skill-path>/u);
  assert.match(readme, /(official|官方)[^\n]*(activation|啟用)[^\n]*(path|路徑)/iu);
});

test("README documents fail-closed review results and posting authorization", () => {
  const readme = read("README.md");

  assert.match(readme, /PR PASS/);
  assert.match(readme, /PR FAIL/);
  assert.match(readme, /PR REVIEW BLOCKED/);
  assert.match(readme, /(explicit|明確)[^\n]*(authoriz|授權)/i);
});
