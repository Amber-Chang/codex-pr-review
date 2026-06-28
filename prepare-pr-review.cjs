#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const { loadConfig } = require("./config.cjs");
const { parsePrReference, readPr } = require("./lib/github.cjs");
const { buildReviewPacket, renderPacketMarkdown } = require("./lib/review-packet.cjs");

function parseArgs(argv) {
  const args = { output: "markdown" };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--output") {
      args.output = argv[index + 1];
      index += 1;
    } else if (current === "--write") {
      args.write = argv[index + 1];
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
  return "Usage: node prepare-pr-review.cjs <pr-url-or-number> [--output json|markdown] [--write packet.json] [--config path]";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage() + "\n");
    return;
  }

  if (!args.prRef) {
    throw new Error(usage());
  }

  const config = loadConfig({ configPath: args.config });
  const ref = parsePrReference(args.prRef, config.ROOT);
  const prData = readPr(ref, config.ROOT);
  const packet = buildReviewPacket({ root: config.ROOT, config, prData });

  if (args.write) {
    const outputPath = path.resolve(config.ROOT, args.write);
    fs.writeFileSync(outputPath, JSON.stringify(packet, null, 2) + "\n");
  }

  if (args.output === "json") {
    process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
    return;
  }

  process.stdout.write(renderPacketMarkdown(packet));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
