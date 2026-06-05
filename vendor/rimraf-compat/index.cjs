"use strict";

const fs = require("node:fs");

function buildOptions(options) {
  return {
    recursive: true,
    force: true,
    maxRetries: 3,
    ...options,
  };
}

function rimraf(target, options, callback) {
  const done = typeof options === "function" ? options : callback;
  const finalOptions = buildOptions(typeof options === "function" ? undefined : options);

  if (done) {
    fs.rm(target, finalOptions, done);
    return undefined;
  }

  return fs.promises.rm(target, finalOptions);
}

rimraf.sync = function rimrafSync(target, options) {
  fs.rmSync(target, buildOptions(options));
};

rimraf.rimraf = rimraf;
rimraf.rimrafSync = rimraf.sync;

module.exports = rimraf;
