#!/usr/bin/env node
/**
 * 整理 GitHub Release 待发布资源（CommonJS，便于用 NODE_PATH 引入隔离安装的 js-yaml）
 *
 * 背景：各平台/架构在独立 job 构建并各自上传 artifact。electron-builder 会为
 * Windows / macOS 生成同名的 `latest.yml` / `latest-mac.yml`（分别只含本架构条目），
 * 直接上传会互相覆盖，导致另一架构无法自动更新。Linux 则使用按架构区分的
 * `latest-linux.yml` / `latest-linux-arm64.yml`，天然不冲突。
 *
 * 本脚本将所有 artifact 扁平化到输出目录：
 *  - 合并 Windows / macOS 的 latest*.yml（合并 files 列表，path/sha512 优先指向 x64）
 *  - 保留各架构 Linux 清单原样
 *  - 剔除调试文件 builder-debug.yml
 *  - 同名二进制去重（保留首个），避免 release 资源重名冲突
 *
 * 用法: node prepare-release-assets.cjs <artifactsDir> <outDir>
 */
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const srcDir = process.argv[2];
const outDir = process.argv[3];

if (!srcDir || !outDir) {
  console.error("用法: node prepare-release-assets.cjs <artifactsDir> <outDir>");
  process.exit(1);
}

/** 需要跨架构合并的更新清单文件名 */
const MERGE_MANIFESTS = new Set(["latest.yml", "latest-mac.yml"]);

/** 不需要上传的文件 */
const SKIP_FILES = new Set(["builder-debug.yml"]);

/**
 * 递归收集目录下的所有文件（跳过 *-unpacked 目录）
 * @param {string} dir 起始目录
 * @param {string[]} [out] 结果累加数组（递归内部使用）
 * @returns {string[]} 收集到的文件路径列表
 */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith("-unpacked")) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

/**
 * 合并多份同名更新清单：合并各架构的 files 列表（按 url 去重）
 * 基准 path/sha512 优先指向 x64
 * @param {Array<Record<string, any>>} docs 同名清单的解析结果数组
 * @returns {Record<string, any>} 合并后的清单对象
 */
const mergeManifests = (docs) => {
  if (docs.length === 1) return docs[0];
  const merged = { ...docs[0] };
  const byUrl = new Map();
  for (const doc of docs) {
    for (const file of doc.files || []) {
      if (!byUrl.has(file.url)) byUrl.set(file.url, file);
    }
  }
  merged.files = [...byUrl.values()];
  const x64 = merged.files.find((file) => /x64|x86_64/i.test(file.url));
  if (x64) {
    merged.path = x64.url;
    merged.sha512 = x64.sha512;
  }
  return merged;
};

fs.mkdirSync(outDir, { recursive: true });

/** @type {Map<string, Array<Record<string, any>>>} 清单名 -> 解析文档数组 */
const manifestDocs = new Map();

/** @type {Set<string>} 已写入输出目录的文件名 */
const seen = new Set();

for (const file of walk(srcDir)) {
  const base = path.basename(file);
  if (SKIP_FILES.has(base)) continue;

  if (MERGE_MANIFESTS.has(base)) {
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    if (!manifestDocs.has(base)) manifestDocs.set(base, []);
    manifestDocs.get(base).push(doc);
    continue;
  }

  if (seen.has(base)) {
    console.warn(`⚠️  跳过重复同名文件: ${base}`);
    continue;
  }
  seen.add(base);
  fs.copyFileSync(file, path.join(outDir, base));
}

for (const [name, docs] of manifestDocs) {
  const merged = mergeManifests(docs);
  fs.writeFileSync(path.join(outDir, name), yaml.dump(merged, { lineWidth: -1 }));
  console.log(`✅ 合并清单 ${name}（files: ${(merged.files || []).length}）`);
}

console.log(`release-assets 准备完成，共 ${fs.readdirSync(outDir).length} 个文件`);
