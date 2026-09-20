import assert from "node:assert/strict";
import test from "node:test";
import { extractTaskbarAction } from "./taskbarAction";

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
