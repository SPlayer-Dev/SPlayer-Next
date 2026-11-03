import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isKeptLocale, shouldCopyDependencyFile } from "./hooks";

describe("原生依赖文件筛选", () => {
  it("better-sqlite3 只保留目标平台的预编译文件", () => {
    const cases: [string, string, boolean][] = [
      ["prebuilds/darwin-arm64.node", "darwin-arm64", true],
      ["prebuilds/win32-x64.node", "darwin-arm64", false],
      ["lib/darwin-arm64.js", "darwin-arm64", true],
      ["lib/linuxmusl-x64.js", "linux-x64", false],
      ["lib/database.js", "linux-x64", true],
      ["lib/methods/wrappers.js", "linux-x64", true],
    ];
    for (const [file, target, expected] of cases) {
      assert.equal(shouldCopyDependencyFile("better-sqlite3", file, target), expected, file);
    }
  });

  it("better-sqlite3 去掉源码、构建脚本与文档", () => {
    for (const file of [
      "deps/sqlite3/sqlite3.c",
      "src/better_sqlite3.cpp",
      "binding.gyp",
      "README.md",
    ]) {
      assert.equal(shouldCopyDependencyFile("better-sqlite3", file, "win32-x64"), false, file);
    }
    assert.equal(shouldCopyDependencyFile("better-sqlite3", "package.json", "win32-x64"), true);
  });

  it("font-list 只保留目标平台的脚本", () => {
    assert.equal(
      shouldCopyDependencyFile("font-list", "libs/win32/fonts.vbs", "win32-arm64"),
      true,
    );
    assert.equal(
      shouldCopyDependencyFile("font-list", "libs/darwin/fontlist", "win32-arm64"),
      false,
    );
    assert.equal(shouldCopyDependencyFile("font-list", "libs/core.js", "win32-arm64"), true);
    assert.equal(shouldCopyDependencyFile("font-list", "index.d.mts", "win32-arm64"), false);
  });
});

describe("Chromium 语言筛选", () => {
  it("保留简体中文与美式英语", () => {
    for (const name of ["zh-CN.pak", "en-US.pak", "zh_CN.lproj", "en.lproj"]) {
      assert.equal(isKeptLocale(name), true, name);
    }
  });

  it("删除其余语言", () => {
    for (const name of [
      "zh-TW.pak",
      "en-GB.pak",
      "ja.pak",
      "zh_TW.lproj",
      "en_GB.lproj",
      "Base.lproj",
    ]) {
      assert.equal(isKeptLocale(name), false, name);
    }
  });
});
