#!/usr/bin/env node
"use strict";

const { execSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const version = process.env.APP_VERSION || require("../package.json").version;
const repo = process.env.GITHUB_REPOSITORY || "SPlayer-Dev/SPlayer-Next";
const prevSha = process.env.PREV_COMMIT_SHA;

let commits = "";
try {
  if (prevSha && /^[0-9a-fA-F]+$/.test(prevSha)) {
    commits = execSync(
      `git log ${prevSha}..HEAD --pretty=format:"- %s ([%h](https://github.com/${repo}/commit/%H))"`,
      { encoding: "utf-8" },
    ).trim();
  }
} catch {
  // prevSha 不在本地或格式不匹配时静默降级
}

if (!commits) {
  try {
    commits = execSync(
      `git log -n 5 --pretty=format:"- %s ([%h](https://github.com/${repo}/commit/%H))"`,
      { encoding: "utf-8" },
    ).trim();
  } catch {
    commits = "- 常规构建更新";
  }
}

const content = [`**版本**: \`${version}\``, "", "### Commits", "", commits, ""].join("\n");

const targetFile = resolve(process.cwd(), process.argv[2] || "notes.md");
writeFileSync(targetFile, content, "utf-8");
console.log(`[GenNightlyNotes] 已生成发布说明至: ${targetFile}`);
