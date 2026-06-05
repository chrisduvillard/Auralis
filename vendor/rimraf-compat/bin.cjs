#!/usr/bin/env node
"use strict";

const rimraf = require("./index.cjs");

const targets = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

Promise.all(targets.map((target) => rimraf(target))).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
