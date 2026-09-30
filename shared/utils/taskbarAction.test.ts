import assert from "node:assert/strict";
import test from "node:test";
import { extractTaskbarAction, extractPortableDir } from "./taskbarAction";

test("提取 Windows 任务栏播放动作", () => {
  assert.equal(extractTaskbarAction(["SPlayer-Next.exe", "--splayer-taskbar-action=next"]), "next");
  assert.equal(
    extractTaskbarAction(["SPlayer-Next.exe", "--inspect", "--splayer-taskbar-action=pause"]),
    "pause",
  );
});

test("忽略未知和空的 Windows 任务栏播放动作", () => {
  assert.equal(extractTaskbarAction(["SPlayer-Next.exe", "--splayer-taskbar-action=delete"]), null);
  assert.equal(extractTaskbarAction(["SPlayer-Next.exe", "--splayer-taskbar-action="]), null);
  assert.equal(extractTaskbarAction(["SPlayer-Next.exe"]), null);
});

test("提取便携目录参数", () => {
  assert.equal(
    extractPortableDir([
      "SPlayer-Next.exe",
      "--splayer-portable-dir=E:\\tmp\\app",
      "--splayer-taskbar-action=next",
    ]),
    "E:\\tmp\\app",
  );
  assert.equal(extractPortableDir(["SPlayer-Next.exe"]), null);
  assert.equal(extractPortableDir(["SPlayer-Next.exe", "--splayer-portable-dir="]), null);
});
