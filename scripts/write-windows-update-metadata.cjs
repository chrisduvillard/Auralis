#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const releaseDir = path.join(process.cwd(), "release");

function wildcardToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

function releaseFiles() {
  try {
    return fs
      .readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    throw new Error(`Windows release directory is missing: ${releaseDir}`);
  }
}

function requireSingleMatch(files, pattern) {
  const regex = wildcardToRegExp(pattern);
  const matches = files.filter((file) => regex.test(file));
  if (matches.length === 0) {
    throw new Error(`Missing Windows release asset matching ${pattern}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Expected one Windows release asset matching ${pattern}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function inferVersion(installerFile) {
  const match = /^Auralis-Setup-(.+)\.exe$/.exec(installerFile);
  if (match?.[1]) {
    return match[1];
  }

  const packageJsonPath = path.join(process.cwd(), "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  }

  throw new Error(`Could not infer Windows update version from ${installerFile}`);
}

function yamlString(value) {
  return JSON.stringify(value);
}

const files = releaseFiles();
const installerFile = requireSingleMatch(files, "Auralis-Setup-*.exe");
const expectedBlockMapFile = `${installerFile}.blockmap`;
if (!files.includes(expectedBlockMapFile)) {
  throw new Error(`Missing Windows release asset matching ${expectedBlockMapFile}`);
}

const installerPath = path.join(releaseDir, installerFile);
const installerStat = fs.statSync(installerPath);
if (installerStat.size <= 0) {
  throw new Error(`Windows release asset is empty: ${installerFile}`);
}

const sha512 = crypto.createHash("sha512").update(fs.readFileSync(installerPath)).digest("base64");
const version = inferVersion(installerFile);
const latestYml = [
  `version: ${version}`,
  "files:",
  `  - url: ${yamlString(installerFile)}`,
  `    sha512: ${yamlString(sha512)}`,
  `    size: ${installerStat.size}`,
  `path: ${yamlString(installerFile)}`,
  `sha512: ${yamlString(sha512)}`,
  `releaseDate: ${yamlString(new Date().toISOString())}`,
  "",
].join("\n");

const metadataPath = path.join(releaseDir, "latest.yml");
fs.writeFileSync(metadataPath, latestYml);
console.log(JSON.stringify({ file: "latest.yml", installerFile, size: latestYml.length }, null, 2));
