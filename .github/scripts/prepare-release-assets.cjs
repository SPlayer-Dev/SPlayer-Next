#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const MANIFEST_SUFFIXES = ["", "-mac", "-linux", "-linux-arm64"];
const SKIP_FILES = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);

/**
 * 递归收集目录下的文件
 * @param {string} dir - 起始目录
 * @param {string[]} [out] - 结果累加数组
 * @returns {string[]} 文件路径
 */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith("-unpacked")) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

/**
 * 判断清单是否需要合并不同架构
 * @param {string} name - 文件名
 * @returns {boolean} 是否需要合并
 */
const shouldMergeManifest = (name) => /^(latest|beta|alpha|nightly)(-mac)?\.yml$/.test(name);

/**
 * 合并同平台不同架构的更新清单
 * @param {Array<Record<string, any>>} docs - 清单内容
 * @returns {Record<string, any>} 合并结果
 */
const mergeManifests = (docs) => {
  const versions = new Set(docs.map((doc) => doc.version));
  if (versions.size !== 1) throw new Error(`同名清单版本不一致: ${[...versions].join(", ")}`);

  const merged = { ...docs[0] };
  const byUrl = new Map();
  for (const doc of docs) {
    for (const file of doc.files || []) {
      if (!byUrl.has(file.url)) byUrl.set(file.url, file);
    }
  }
  merged.files = [...byUrl.values()];
  const preferred = merged.files.find((file) => /x64|x86_64/i.test(file.url)) ?? merged.files[0];
  if (preferred) {
    merged.path = preferred.url;
    merged.sha512 = preferred.sha512;
  }
  return merged;
};

/**
 * 从版本号解析发布通道
 * @param {string} version - 应用版本
 * @returns {"latest" | "beta" | "alpha" | "nightly"} 发布通道
 */
const resolveChannel = (version) => {
  if (/-nightly(?:\.|$)/.test(version)) return "nightly";
  if (/-alpha(?:\.|$)/.test(version)) return "alpha";
  if (/-beta(?:\.|$)/.test(version)) return "beta";
  if (version.includes("-")) throw new Error(`不支持的预发布版本格式: ${version}`);
  return "latest";
};

const ALIAS_CHANNELS_MAP = {
  latest: ["beta", "alpha"],
  beta: ["alpha"],
};

const VALIDATE_CHANNELS_MAP = {
  latest: ["latest", "beta", "alpha"],
  beta: ["beta", "alpha"],
  alpha: ["alpha"],
  nightly: ["nightly"],
};

/**
 * 为更不稳定的订阅通道创建清单别名
 * @param {string} outDir - 发布资源目录
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - 发布通道
 */
const createChannelAliases = (outDir, channel) => {
  const aliases = ALIAS_CHANNELS_MAP[channel] ?? [];
  for (const suffix of MANIFEST_SUFFIXES) {
    const source = path.join(outDir, `${channel}${suffix}.yml`);
    if (!fs.existsSync(source)) throw new Error(`缺少更新清单: ${path.basename(source)}`);
    for (const alias of aliases) {
      fs.copyFileSync(source, path.join(outDir, `${alias}${suffix}.yml`));
    }
  }
};

/**
 * 校验清单结构和引用资源
 * @param {string} outDir - 发布资源目录
 * @param {string} version - 应用版本
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - 发布通道
 */
const validateManifests = (outDir, version, channel) => {
  const channels = VALIDATE_CHANNELS_MAP[channel] ?? [channel];
  for (const current of channels) {
    for (const suffix of MANIFEST_SUFFIXES) {
      const name = `${current}${suffix}.yml`;
      const filePath = path.join(outDir, name);
      if (!fs.existsSync(filePath)) throw new Error(`缺少更新清单: ${name}`);

      const doc = yaml.load(fs.readFileSync(filePath, "utf8"));
      if (doc.version !== version) throw new Error(`${name} 的版本不是 ${version}`);
      if (!Array.isArray(doc.files) || doc.files.length === 0) {
        throw new Error(`${name} 没有可更新文件`);
      }
      const selected = doc.files.find((item) => item.url === doc.path);
      if (!selected || selected.sha512 !== doc.sha512) {
        throw new Error(`${name} 的默认更新文件无效`);
      }
      for (const item of doc.files) {
        const asset = path.join(outDir, path.basename(item.url));
        if (!fs.existsSync(asset)) throw new Error(`${name} 引用了不存在的资源: ${item.url}`);
        if (item.size != null && fs.statSync(asset).size !== item.size) {
          throw new Error(`${name} 的资源大小不匹配: ${item.url}`);
        }
      }
    }
  }
};

/**
 * 整理并校验 GitHub Release 资源
 * @param {string} srcDir - 构建产物目录
 * @param {string} outDir - 发布资源目录
 * @param {string} version - 应用版本
 */
const prepareReleaseAssets = (srcDir, outDir, version) => {
  const channel = resolveChannel(version);
  fs.mkdirSync(outDir, { recursive: true });

  const manifestDocs = new Map();
  const seen = new Set();
  for (const file of walk(srcDir)) {
    const name = path.basename(file);
    if (SKIP_FILES.has(name)) continue;
    if (shouldMergeManifest(name)) {
      const doc = yaml.load(fs.readFileSync(file, "utf8"));
      if (!manifestDocs.has(name)) manifestDocs.set(name, []);
      manifestDocs.get(name).push(doc);
      continue;
    }
    if (seen.has(name)) throw new Error(`发现重复发布资源: ${name}`);
    seen.add(name);
    fs.copyFileSync(file, path.join(outDir, name));
  }

  for (const [name, docs] of manifestDocs) {
    const merged = mergeManifests(docs);
    fs.writeFileSync(path.join(outDir, name), yaml.dump(merged, { lineWidth: -1 }));
    console.log(`合并清单 ${name}（files: ${merged.files.length}）`);
  }

  createChannelAliases(outDir, channel);
  validateManifests(outDir, version, channel);
  console.log(`release-assets 校验完成，共 ${fs.readdirSync(outDir).length} 个文件`);
};

if (require.main === module) {
  const [srcDir, outDir, version] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error("用法: node prepare-release-assets.cjs <artifactsDir> <outDir> <version>");
    process.exit(1);
  }
  prepareReleaseAssets(srcDir, outDir, version);
}

module.exports = { mergeManifests, prepareReleaseAssets, resolveChannel };
