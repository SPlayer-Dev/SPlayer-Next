"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { prepareReleaseAssets, resolveChannel } = require("./prepare-release-assets.cjs");

const createArtifact = (dir, name, content) => {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return { url: name, sha512: Buffer.from(name).toString("base64"), size: content.length };
};

const writeManifest = (dir, name, version, asset) => {
  fs.writeFileSync(
    path.join(dir, name),
    yaml.dump({ version, files: [asset], path: asset.url, sha512: asset.sha512 }),
  );
};

const createFixture = (root, version, channel) => {
  const assets = [
    ["win-x64", `${channel}.yml`, "app-x64-setup.exe"],
    ["win-arm64", `${channel}.yml`, "app-arm64-setup.exe"],
    ["mac-x64", `${channel}-mac.yml`, "app-x64.zip"],
    ["mac-arm64", `${channel}-mac.yml`, "app-arm64.zip"],
    ["linux-x64", `${channel}-linux.yml`, "app-x86_64.AppImage"],
    ["linux-arm64", `${channel}-linux-arm64.yml`, "app-arm64.AppImage"],
  ];
  for (const [folder, manifest, assetName] of assets) {
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    const asset = createArtifact(dir, assetName, Buffer.from(assetName));
    writeManifest(dir, manifest, version, asset);
  }
};

test("正式版生成 latest、beta 和 alpha 的完整更新清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-release-stable-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.2.0", "latest");
    prepareReleaseAssets(src, out, "1.2.0");
    for (const channel of ["latest", "beta", "alpha"]) {
      for (const suffix of ["", "-mac", "-linux", "-linux-arm64"]) {
        assert.equal(fs.existsSync(path.join(out, `${channel}${suffix}.yml`)), true);
      }
    }
    const windows = yaml.load(fs.readFileSync(path.join(out, "latest.yml"), "utf8"));
    assert.equal(windows.files.length, 2);
    assert.equal(windows.path, "app-x64-setup.exe");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Beta 版生成 beta 和 alpha 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-release-beta-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.3.0-beta.1", "beta");
    prepareReleaseAssets(src, out, "1.3.0-beta.1");
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Alpha 版只发布 alpha 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-release-alpha-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.4.0-alpha.1", "alpha");
    prepareReleaseAssets(src, out, "1.4.0-alpha.1");
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Nightly 版只发布 nightly 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-release-nightly-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.4.0-nightly.270", "nightly");
    prepareReleaseAssets(src, out, "1.4.0-nightly.270");
    assert.equal(fs.existsSync(path.join(out, "nightly.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("拒绝未支持的预发布通道", () => {
  assert.throws(() => resolveChannel("1.3.0-rc.1"), /不支持的预发布版本格式/);
});
