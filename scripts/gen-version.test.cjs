"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveBaseVersion, nextBetaNumber } = require("./gen-version.cjs");

test("package.json 高于最新正式版时沿用 package.json", () => {
  assert.equal(resolveBaseVersion("1.2.1", ["v1.2.0", "v1.2.0-alpha.1", "nightly"]), "1.2.1");
  assert.equal(resolveBaseVersion("1.3.0", ["v1.2.0"]), "1.3.0");
});

test("正式版发布后未改 package.json 时自动跳到下一个 patch", () => {
  assert.equal(resolveBaseVersion("1.2.1", ["v1.2.0", "v1.2.1"]), "1.2.2");
  assert.equal(resolveBaseVersion("1.2.0", ["v1.10.0", "v1.9.0"]), "1.10.1");
});

test("没有正式版时使用 package.json", () => {
  assert.equal(resolveBaseVersion("0.1.0", []), "0.1.0");
});

test("Beta 序号按同基准版本的最大值递增", () => {
  assert.equal(nextBetaNumber("1.2.1", ["v1.2.0-beta.4"]), 1);
  assert.equal(nextBetaNumber("1.2.1", ["v1.2.1-beta.1", "v1.2.1-beta.10", "v1.2.1-beta.2"]), 11);
});
