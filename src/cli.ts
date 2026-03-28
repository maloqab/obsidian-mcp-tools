#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: obsidian-mcp-tools <vault-path> [vault-path...]");
  process.exit(1);
}

console.error(`obsidian-mcp-tools: starting with vaults: ${args.join(", ")}`);
