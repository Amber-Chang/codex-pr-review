#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const { loadConfig } = require("./config.cjs");
const { parsePrReference, postReviewComments } = require("./lib/github.cjs");

function parseArgs(argv) {
  const args = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--input") {
      args.input = argv[index + 1];
      index += 1;
    } else if (current === "--config") {
      args.config = argv[index + 1];
      index += 1;
    } else if (current === "--help" || current === "-h") {
      args.help = true;
    } else {
      positionals.push(current);
    }
  }

  args.prRef = positionals[0];
  return args;
}

function usage() {
  return "Usage: node post-pr-review-comments.cjs <pr-url-or-number> --input comments.json [--config path]";
}

function loadComments(root, filePath) {
  const absolutePath = path.resolve(root, filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const comments = Array.isArray(parsed) ? parsed : parsed.comments;

  if (!Array.isArray(comments)) {
    throw new Error("Comments JSON must be an array or an object with a comments array.");
  }

  for (const comment of comments) {
    if (!comment.body) {
      throw new Error("Each comment requires a body.");
    }
  }

  return comments;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    return;
  }

  if (!args.prRef || !args.input) {
    throw new Error(usage());
  }

  const config = loadConfig({ configPath: args.config });
  const ref = parsePrReference(args.prRef, config.ROOT);
  const comments = loadComments(config.ROOT, args.input);
  const result = postReviewComments(ref, config.ROOT, comments);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
