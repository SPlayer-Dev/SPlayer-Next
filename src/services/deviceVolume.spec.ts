import { describe, expect, it } from "vitest";
import { getDeviceVolume, setDeviceVolume } from "./deviceVolume";

describe("deviceVolume", () => {
  it("保存并读取设备音量，无记录返回 null", () => {
    setDeviceVolume("device-a", 0.5);
    expect(getDeviceVolume("device-a")).toBe(0.5);
    expect(getDeviceVolume("device-unknown")).toBeNull();
  });

  it("读取时对越界值收拢到 0 ~ 1", () => {
    setDeviceVolume("device-clamp", 2);
    expect(getDeviceVolume("device-clamp")).toBe(1);
  });

  it("超出上限时淘汰最久未更新的记录", async () => {
    setDeviceVolume("device-old", 0.1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    for (let index = 0; index < 30; index++) {
      setDeviceVolume(`device-extra-${index}`, 0.2);
    }
    expect(getDeviceVolume("device-old")).toBeNull();
    expect(getDeviceVolume("device-extra-29")).toBe(0.2);
  });
});
