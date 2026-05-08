#!/usr/bin/env node
// flow CLI entry point. Pure JS so it runs without a TypeScript runtime.
// Imports the compiled output from dist/. If dist/ is missing (someone
// cloned the repo and didn't build), point them at `npm run build`.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(__dirname, "..", "dist", "index.js");

if (!existsSync(distEntry)) {
  console.error(
    "flow: dist/index.js is missing. Run `npm run build` inside packages/flow-cli to compile the TypeScript sources."
  );
  process.exit(1);
}

import(distEntry).catch((err) => {
  console.error("flow: failed to start —", err?.message ?? err);
  process.exit(1);
});
