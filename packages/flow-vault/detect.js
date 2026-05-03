/**
 * detect.js — derive (projectName, environment) from the host app.
 *
 * Project name: walk up from cwd looking for the nearest package.json,
 *   read its "name" field. Stable per-project, cross-machine.
 * Environment: VERCEL_ENV (deploy platform signal) → NODE_ENV → "development".
 *
 * Both fail-soft: if package.json can't be found or parsed, projectName
 * is null and the runtime should skip the vault fetch.
 */

const fs = require("fs");
const path = require("path");

function findPackageJson(startDir) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function getProjectName(startDir = process.cwd()) {
  const pkgPath = findPackageJson(startDir);
  if (!pkgPath) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : null;
  } catch {
    return null;
  }
}

function getEnvironment() {
  const vercel = process.env.VERCEL_ENV;
  if (vercel === "production" || vercel === "preview" || vercel === "development") {
    return vercel;
  }
  const node = process.env.NODE_ENV;
  if (node === "production" || node === "test") return node;
  return "development";
}

function detect(startDir = process.cwd()) {
  return {
    projectName: getProjectName(startDir),
    environment: getEnvironment(),
  };
}

module.exports = { detect, getProjectName, getEnvironment, findPackageJson };
