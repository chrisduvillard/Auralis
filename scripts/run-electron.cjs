#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { accessSync, constants, statSync } = require("node:fs");
const { join } = require("node:path");

const electronCli = join(__dirname, "..", "node_modules", "electron", "cli.js");
const chromeSandbox = join(__dirname, "..", "node_modules", "electron", "dist", "chrome-sandbox");
const args = process.argv.slice(2);

function canUseLinuxSandbox() {
  if (process.platform !== "linux") {
    return true;
  }

  try {
    accessSync(chromeSandbox, constants.X_OK);
    const stats = statSync(chromeSandbox);
    return stats.uid === 0 && (stats.mode & 0o4000) === 0o4000;
  } catch {
    return false;
  }
}

function printSandboxHelp() {
  console.error(
    [
      "Auralis refused to start because Electron's Linux sandbox helper is not root-owned setuid.",
      `Expected helper: ${chromeSandbox}`,
      "Fix locally with:",
      `  sudo chown root:root ${chromeSandbox}`,
      `  sudo chmod 4755 ${chromeSandbox}`,
      "For a temporary smoke check only, set AURALIS_ALLOW_NO_SANDBOX=1.",
    ].join("\n"),
  );
}

const hasUsableSandbox = canUseLinuxSandbox();
const allowNoSandbox = process.env.AURALIS_ALLOW_NO_SANDBOX === "1";

if (!hasUsableSandbox && !allowNoSandbox) {
  printSandboxHelp();
  process.exit(1);
}

const electronArgs = hasUsableSandbox ? args : ["--no-sandbox", ...args];
const result = spawnSync(process.execPath, [electronCli, ...electronArgs], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
