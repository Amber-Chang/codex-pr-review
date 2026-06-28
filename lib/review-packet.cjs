const fs = require("fs");
const path = require("path");

const { loadKnowledge, searchKnowledge } = require("./knowledge.cjs");

function detectModuleDocs(files, moduleDocHints) {
  const matchedDocs = new Set();
  for (const file of files) {
    for (const hint of moduleDocHints) {
      if (file.filename.startsWith(hint.prefix)) {
        matchedDocs.add(hint.doc);
      }
    }
  }
  return Array.from(matchedDocs).sort();
}

function loadModuleDocSummaries(root, docs) {
  return docs.map((docPath) => {
    const absolutePath = path.resolve(root, docPath);
    const content = fs.readFileSync(absolutePath, "utf8");
    return {
      path: docPath,
      summary: content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("|"))
        .slice(0, 12),
    };
  });
}

function buildReviewPacket({ root, config, prData }) {
  const knowledge = loadKnowledge({
    root,
    knowledgeSources: config.knowledgeSources,
    errorPatternsPath: config.errorPatternsPath,
  });
  const queryText = [
    prData.pullRequest.title,
    prData.pullRequest.body || "",
    prData.files.map((file) => file.filename).join(" "),
  ].join("\n");
  const moduleDocs = detectModuleDocs(prData.files, config.moduleDocHints || []);
  const moduleDocSummaries = loadModuleDocSummaries(root, moduleDocs);

  return {
    generatedAt: new Date().toISOString(),
    pr: {
      owner: prData.ref.owner,
      repo: prData.ref.repo,
      number: prData.ref.number,
      title: prData.pullRequest.title,
      body: prData.pullRequest.body || "",
      state: prData.pullRequest.state,
      baseRef: prData.pullRequest.base.ref,
      baseSha: prData.pullRequest.base.sha,
      headRef: prData.pullRequest.head.ref,
      headSha: prData.pullRequest.head.sha,
      author: prData.pullRequest.user && prData.pullRequest.user.login,
      htmlUrl: prData.pullRequest.html_url,
    },
    files: prData.files.map((file) => ({
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch || "",
      previousFilename: file.previous_filename || null,
    })),
    knowledge: knowledge.sources.map((source) => ({
      id: source.id,
      title: source.title,
      path: source.path,
      kind: source.kind,
      summary: source.summary,
    })),
    matchedKnowledge: searchKnowledge(knowledge, queryText),
    errorPatterns: knowledge.errorPatterns,
    moduleDocs: moduleDocSummaries,
    reviewInstructions: [
      "Read the matched SPEC / PRD / module docs before judging behavior.",
      "Prioritize concrete bugs, contract drift, privacy/RBAC issues, and missing tests.",
      "Only post GitHub comments for findings that have a clear path/body and high confidence.",
      "Move low-confidence or non-anchorable findings into the final summary instead of forcing a line comment.",
    ],
  };
}

function renderPacketMarkdown(packet) {
  const lines = [];
  lines.push(`# PR Review Packet`);
  lines.push("");
  lines.push(`- PR: ${packet.pr.owner}/${packet.pr.repo}#${packet.pr.number}`);
  lines.push(`- Title: ${packet.pr.title}`);
  lines.push(`- Base -> Head: ${packet.pr.baseRef} -> ${packet.pr.headRef}`);
  lines.push(`- URL: ${packet.pr.htmlUrl}`);
  lines.push(`- Files changed: ${packet.files.length}`);
  lines.push("");

  lines.push("## Knowledge Loaded");
  for (const source of packet.knowledge) {
    lines.push(`- ${source.title} (${source.path})`);
    for (const item of source.summary.slice(0, 3)) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push("");

  lines.push("## Best Matches");
  for (const match of packet.matchedKnowledge.slice(0, 8)) {
    lines.push(`- [${match.type}] ${match.title} (${match.score})`);
    for (const item of match.summary.slice(0, 2)) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push("");

  if (packet.moduleDocs.length > 0) {
    lines.push("## Suggested Module Docs");
    for (const doc of packet.moduleDocs) {
      lines.push(`- ${doc.path}`);
      for (const item of doc.summary.slice(0, 2)) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push("");
  }

  lines.push("## Changed Files");
  for (const file of packet.files) {
    lines.push(
      `- ${file.path} [${file.status}] +${file.additions} -${file.deletions} (${file.changes} changes)`,
    );
  }
  lines.push("");

  lines.push("## Review Instructions");
  for (const instruction of packet.reviewInstructions) {
    lines.push(`- ${instruction}`);
  }
  lines.push("");

  return lines.join("\n");
}

module.exports = {
  buildReviewPacket,
  renderPacketMarkdown,
};
