const fs = require("fs");
const path = require("path");

function resolveWithinRoot(root, relativePath) {
  return path.resolve(root, relativePath);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeMarkdown(markdown, maxItems = 12) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  function ensureSection(title) {
    if (!current || current.title !== title) {
      current = { title, bullets: [] };
      sections.push(current);
    }
    return current;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      ensureSection(normalizeWhitespace(headingMatch[1]));
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      ensureSection(current ? current.title : "Overview").bullets.push(
        normalizeWhitespace(bulletMatch[1]),
      );
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      ensureSection(current ? current.title : "Overview").bullets.push(
        normalizeWhitespace(orderedMatch[1]),
      );
      continue;
    }

    if (/^\|.+\|$/.test(trimmed)) {
      continue;
    }

    const section = ensureSection(current ? current.title : "Overview");
    if (section.bullets.length === 0) {
      section.bullets.push(normalizeWhitespace(trimmed));
    }
  }

  const summary = [];
  for (const section of sections) {
    for (const bullet of section.bullets) {
      summary.push(`${section.title}: ${bullet}`);
      if (summary.length >= maxItems) {
        return summary;
      }
    }
  }

  return summary;
}

function loadErrorPatterns(root, relativePath) {
  // Generic plugins may run without any error-pattern store. Treat a missing
  // path or a non-existent file as "no patterns" instead of crashing.
  if (!relativePath) {
    return [];
  }
  const absolutePath = resolveWithinRoot(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.patterns) ? parsed.patterns : [];
}

function loadKnowledge({ root, knowledgeSources, errorPatternsPath }) {
  const sources = knowledgeSources.map((source) => {
    const absolutePath = resolveWithinRoot(root, source.path);
    const content = fs.readFileSync(absolutePath, "utf8");
    return {
      ...source,
      absolutePath,
      content,
      summary: summarizeMarkdown(content),
    };
  });

  return {
    sources,
    errorPatterns: loadErrorPatterns(root, errorPatternsPath),
  };
}

function tokenize(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_#./-]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreText(tokens, text, weight) {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += weight;
    }
  }
  return score;
}

function searchKnowledge(knowledge, query, limit = 8) {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const matches = [];
  for (const source of knowledge.sources) {
    const summaryText = source.summary.join("\n");
    const score =
      scoreText(tokens, source.title, 4) +
      scoreText(tokens, source.path, 3) +
      scoreText(tokens, summaryText, 2) +
      scoreText(tokens, source.content.slice(0, 4000), 1);

    if (score > 0) {
      matches.push({
        type: "knowledge-source",
        id: source.id,
        title: source.title,
        path: source.path,
        score,
        summary: source.summary.slice(0, 4),
      });
    }
  }

  for (const pattern of knowledge.errorPatterns) {
    const blob = [
      pattern.title,
      pattern.summary,
      pattern.symptoms,
      pattern.remediation,
      pattern.tags && pattern.tags.join(" "),
    ]
      .filter(Boolean)
      .join("\n");
    const score = scoreText(tokens, blob, 2);
    if (score > 0) {
      matches.push({
        type: "error-pattern",
        id: pattern.id,
        title: pattern.title,
        score,
        summary: [pattern.summary].filter(Boolean),
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, limit);
}

function addErrorPattern({ root, errorPatternsPath }, newPattern) {
  // Writing a pattern requires a real store; safeDefaults leaves this null.
  if (!errorPatternsPath) {
    throw new Error("addErrorPattern requires errorPatternsPath to be configured.");
  }
  const absolutePath = resolveWithinRoot(root, errorPatternsPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
  const pattern = {
    id: newPattern.id || `pattern-${Date.now()}`,
    title: newPattern.title,
    summary: newPattern.summary,
    symptoms: newPattern.symptoms || [],
    remediation: newPattern.remediation || "",
    tags: newPattern.tags || [],
    source: newPattern.source || "codex-review-agent",
    createdAt: newPattern.createdAt || new Date().toISOString(),
  };
  patterns.push(pattern);
  fs.writeFileSync(absolutePath, JSON.stringify({ patterns }, null, 2) + "\n");
  return pattern;
}

module.exports = {
  addErrorPattern,
  loadKnowledge,
  searchKnowledge,
  summarizeMarkdown,
  tokenize,
};
