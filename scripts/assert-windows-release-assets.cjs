#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const releaseDir = path.join(process.cwd(), "release");
const requireUpdateMetadata = process.env.AURALIS_REQUIRE_UPDATE_METADATA === "1";

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

function requireMatch(files, pattern) {
  const regex = wildcardToRegExp(pattern);
  const matches = files.filter((file) => regex.test(file));
  if (matches.length === 0) {
    throw new Error(`Missing Windows release asset matching ${pattern}`);
  }
  return matches;
}

function requireSingleMatch(files, pattern) {
  const matches = requireMatch(files, pattern);
  if (matches.length > 1) {
    throw new Error(
      `Expected one Windows release asset matching ${pattern}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function requireNonEmptyAsset(file) {
  const fullPath = path.join(releaseDir, file);
  const stat = fs.statSync(fullPath);
  if (stat.size <= 0) {
    throw new Error(`Windows release asset is empty: ${file}`);
  }
  return { file, size: stat.size };
}

function requireMatchingBlockMaps(installerAssets) {
  return installerAssets.map(({ file }) => requireNonEmptyAsset(`${file}.blockmap`));
}

function rejectStaleBlockMaps(files, blockMapAssets) {
  const expected = new Set(blockMapAssets.map(({ file }) => file));
  const staleBlockMaps = files.filter(
    (file) => wildcardToRegExp("Auralis-Setup-*.exe.blockmap").test(file) && !expected.has(file),
  );
  if (staleBlockMaps.length > 0) {
    throw new Error(`Found stale Windows blockmap asset(s): ${staleBlockMaps.join(", ")}`);
  }
}

function parseYamlScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }

  return trimmed;
}

function inferInstallerVersion(installerFile) {
  const match = /^Auralis-Setup-(.+)\.exe$/.exec(installerFile);
  if (!match?.[1]) {
    throw new Error(`Could not infer Windows installer version from ${installerFile}`);
  }
  return match[1];
}

function topLevelYamlValue(contents, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(contents);
  return match ? parseYamlScalar(match[1]) : null;
}

function metadataFileEntry(contents) {
  const urlMatch = /^\s+-\s+url:\s*(.+)$/m.exec(contents);
  if (!urlMatch) {
    return null;
  }

  const afterUrl = contents.slice(urlMatch.index + urlMatch[0].length);
  const shaMatch = /^\s+sha512:\s*(.+)$/m.exec(afterUrl);
  const sizeMatch = /^\s+size:\s*(\d+)\s*$/m.exec(afterUrl);

  return {
    sha512: shaMatch ? parseYamlScalar(shaMatch[1]) : null,
    size: sizeMatch ? Number(sizeMatch[1]) : null,
    url: parseYamlScalar(urlMatch[1]),
  };
}

function validateLatestMetadata(metadataAsset, installerAsset) {
  const metadataPath = path.join(releaseDir, metadataAsset.file);
  const contents = fs.readFileSync(metadataPath, "utf-8");
  const pathValue = topLevelYamlValue(contents, "path");
  const sha512Value = topLevelYamlValue(contents, "sha512");
  const versionValue = topLevelYamlValue(contents, "version");
  const fileEntry = metadataFileEntry(contents);

  const expectedVersion = inferInstallerVersion(installerAsset.file);
  if (versionValue !== expectedVersion) {
    throw new Error(
      `${metadataAsset.file} version must be ${expectedVersion}, not ${versionValue || "missing"}`,
    );
  }

  if (!fileEntry) {
    throw new Error(`${metadataAsset.file} must include a files[0].url entry`);
  }

  if (pathValue !== installerAsset.file || fileEntry.url !== installerAsset.file) {
    throw new Error(
      `${metadataAsset.file} must point at ${installerAsset.file}, not ${pathValue || fileEntry.url || "missing installer path"}`,
    );
  }

  const expectedSha512 = crypto
    .createHash("sha512")
    .update(fs.readFileSync(path.join(releaseDir, installerAsset.file)))
    .digest("base64");

  if (sha512Value !== expectedSha512 || fileEntry.sha512 !== expectedSha512) {
    throw new Error(`${metadataAsset.file} has stale sha512 metadata for ${installerAsset.file}`);
  }

  if (fileEntry.size !== installerAsset.size) {
    throw new Error(`${metadataAsset.file} has stale size metadata for ${installerAsset.file}`);
  }
}

const files = releaseFiles();
const installerAssets = [requireNonEmptyAsset(requireSingleMatch(files, "Auralis-Setup-*.exe"))];
const blockMapAssets = requireMatchingBlockMaps(installerAssets);
rejectStaleBlockMaps(files, blockMapAssets);
const updateMetadataAssets = requireUpdateMetadata
  ? requireMatch(files, "latest*.yml").map(requireNonEmptyAsset)
  : files.filter((file) => wildcardToRegExp("latest*.yml").test(file)).map(requireNonEmptyAsset);
updateMetadataAssets.forEach((metadataAsset) => {
  validateLatestMetadata(metadataAsset, installerAssets[0]);
});

console.log(
  JSON.stringify(
    {
      blockMapAssets,
      installerAssets,
      updateMetadataAssets,
    },
    null,
    2,
  ),
);
