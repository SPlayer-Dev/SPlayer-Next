#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const version = process.env.APP_VERSION || require("../package.json").version;
const repo = process.env.GITHUB_REPOSITORY || "SPlayer-Dev/SPlayer-Next";
const prevSha = process.env.PREV_COMMIT_SHA;

const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
const commits = execFileSync(
  "git",
  [
    "log",
    ...(prevSha ? [`${prevSha}..${currentSha}`] : ["-n", "5"]),
    `--pretty=format:- %s ([%h](https://github.com/${repo}/commit/%H))`,
  ],
  { encoding: "utf-8" },
).trim();

const content = [
  `**版本**: \`${version}\``,
  "",
  prevSha ? "### 本次更新" : "### 近期提交",
  "",
  commits || "本次构建没有新增提交",
  "",
  ...(prevSha
    ? [`[完整变更](https://github.com/${repo}/compare/${prevSha}...${currentSha})`, ""]
    : []),
].join("\n");

const targetFile = resolve(process.cwd(), process.argv[2] || "notes.md");
writeFileSync(targetFile, content, "utf-8");
console.log(`[GenNightlyNotes] 已生成发布说明至: ${targetFile}`);
