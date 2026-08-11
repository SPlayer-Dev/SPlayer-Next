import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateDeviceChange } from "./devicePolicy";

describe("evaluateDeviceChange", () => {
  it("跟随系统默认且默认输出切换时重建", () => {
    assert.deepEqual(evaluateDeviceChange("扬声器", "耳机", null), {
      defaultChanged: true,
      shouldReinit: true,
    });
  });

  it("用户选择固定设备时不因系统默认变化重建", () => {
    assert.deepEqual(evaluateDeviceChange("扬声器", "耳机", "USB DAC"), {
      defaultChanged: true,
      shouldReinit: false,
    });
  });

  it("默认设备暂时消失时等待设备恢复", () => {
    assert.deepEqual(evaluateDeviceChange("扬声器", null, null), {
      defaultChanged: true,
      shouldReinit: false,
    });
  });

  it("设备列表变化但默认设备不变时不重建", () => {
    assert.deepEqual(evaluateDeviceChange("扬声器", "扬声器", null), {
      defaultChanged: false,
      shouldReinit: false,
    });
  });
});
