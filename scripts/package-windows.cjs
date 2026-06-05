#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const allowedTargets = new Set(["nsis", "dir"]);
const target = process.argv[2] ?? "nsis";
const passthroughArgs = process.argv.slice(3);
const unsignedSignAndEditOverride = "--config.win.signAndEditExecutable=false";
const signingEnvNames = [
  "CSC_LINK",
  "WIN_CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_KEY_PASSWORD",
  "CSC_NAME",
];

if (!allowedTargets.has(target)) {
  console.error(`Unsupported Windows package target: ${target}`);
  console.error(`Expected one of: ${Array.from(allowedTargets).join(", ")}`);
  process.exit(2);
}

function isEnabled(value) {
  return value === "1" || value === "true";
}

function hasSignAndEditOverride(args) {
  return args.some((arg) => arg.startsWith("--config.win.signAndEditExecutable="));
}

const signingEnabled = isEnabled(process.env.AURALIS_WINDOWS_SIGNING);
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};

if (!signingEnabled) {
  for (const name of signingEnvNames) {
    env[name] = "";
  }
}

const localUnsignedArgs =
  signingEnabled || hasSignAndEditOverride(passthroughArgs) ? [] : [unsignedSignAndEditOverride];
const electronBuilderCli = require.resolve("electron-builder/cli.js");
const result = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    "--win",
    target,
    "--x64",
    "--publish",
    "never",
    ...localUnsignedArgs,
    ...passthroughArgs,
  ],
  {
    env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
