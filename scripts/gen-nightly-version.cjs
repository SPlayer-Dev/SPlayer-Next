#!/usr/bin/env node
"use strict";

const { execSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const pkgPath = resolve(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const rawVersion = pkg.version;
// 提取主次修版本号，去掉已有的预发布标签
const match = /^(\d+\.\d+\.\d+)/.exec(rawVersion);
if (!match) {
  console.error(`[GenNightlyVersion] 错误：无法从版本号 ${rawVersion} 中提取基准版本`);
  process.exit(1);
}

const baseVersion = match[1];

let commitCount = 0;
try {
  commitCount = Number.parseInt(
    execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim(),
    10,
  );
} catch (error) {
  console.error("[GenNightlyVersion] 错误：无法获取 git 提交次数", error);
  process.exit(1);
}

if (Number.isNaN(commitCount) || commitCount <= 0) {
  console.error(`[GenNightlyVersion] 错误：获取到的提交次数无效: ${commitCount}`);
  process.exit(1);
}

const nightlyVersion = `${baseVersion}-nightly.${commitCount}`;
pkg.version = nightlyVersion;

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
console.log(`[GenNightlyVersion] 版本已更新为: ${nightlyVersion}`);
