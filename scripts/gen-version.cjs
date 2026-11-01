#!/usr/bin/env node
"use strict";

const { execSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CHANNELS = ["beta", "nightly", "dev"];

/**
 * 比较两个 x.y.z 版本
 * @param {string} left - 版本号
 * @param {string} right - 版本号
 * @returns {number} 大于 0 表示 left 更新
 */
const compareVersion = (left, right) => {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
};

/**
 * 推导预发布的基准版本：正式版已发布时自动跳到下一个 patch，package.json 写得更高时以它为准
 * @param {string} packageBase - package.json 的 x.y.z
 * @param {string[]} tags - 仓库全部 tag
 * @returns {string} 基准版本
 */
const resolveBaseVersion = (packageBase, tags) => {
  const stable = tags
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1])
    .filter(Boolean)
    .sort(compareVersion)
    .at(-1);
  if (!stable || compareVersion(packageBase, stable) > 0) return packageBase;
  const [major, minor, patch] = stable.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
};

/**
 * 计算下一个 Beta 序号
 * @param {string} base - 基准版本
 * @param {string[]} tags - 仓库全部 tag
 * @returns {number} 序号
 */
const nextBetaNumber = (base, tags) => {
  const numbers = tags
    .filter((tag) => tag.startsWith(`v${base}-beta.`))
    .map((tag) => Number(tag.slice(`v${base}-beta.`.length)))
    .filter(Number.isInteger);
  return Math.max(0, ...numbers) + 1;
};

if (require.main === module) {
  const channel = process.argv[2];
  if (!CHANNELS.includes(channel)) {
    console.error(`[GenVersion] 用法：node gen-version.cjs <${CHANNELS.join("|")}>`);
    process.exit(1);
  }

  const pkgPath = resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const match = /^(\d+\.\d+\.\d+)/.exec(pkg.version);
  if (!match) {
    console.error(`[GenVersion] 错误：无法从版本号 ${pkg.version} 中提取基准版本`);
    process.exit(1);
  }

  const git = (args) => execSync(`git ${args}`, { encoding: "utf-8" }).trim();
  const tags = git("tag -l").split("\n");
  const base = resolveBaseVersion(match[1], tags);

  let suffix;
  if (channel === "beta") {
    suffix = nextBetaNumber(base, tags);
  } else {
    suffix = Number.parseInt(git("rev-list --count HEAD"), 10);
    if (Number.isNaN(suffix) || suffix <= 0) {
      console.error(`[GenVersion] 错误：获取到的提交次数无效: ${suffix}`);
      process.exit(1);
    }
  }

  pkg.version = `${base}-${channel}.${suffix}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  console.log(`[GenVersion] 版本已更新为: ${pkg.version}`);
}

module.exports = { resolveBaseVersion, nextBetaNumber };
