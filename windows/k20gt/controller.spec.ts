import { describe, expect, it, vi } from "vitest";
import { K20GTController, isK20GT } from "./controller";
import { encodeK20GTReport } from "@shared/utils/k20gt";

/**
 * 创建可控制写入与插拔的 HID 测试环境
 * @returns 设备、事件源与状态回调
 */
function fixture() {
  const device = Object.assign(new EventTarget(), {
    vendorId: 0x3837,
    productId: 0x60c6,
    collections: [{ children: [{ outputReports: [{ reportId: 0xbc }] }] }],
    opened: false,
    open: vi.fn(async () => {
      device.opened = true;
    }),
    close: vi.fn(async () => {
      device.opened = false;
    }),
    sendReport: vi.fn().mockResolvedValue(undefined),
  });
  const hid = Object.assign(new EventTarget(), {
    getDevices: vi.fn(async () => [device as unknown as HIDDevice]),
  });
  const onStatus = vi.fn();
  const controller = new K20GTController(hid as unknown as HID, onStatus);
  return { device, hid, onStatus, controller };
}

/**
 * 构造设备插拔事件
 * @param type - 事件名称
 * @param device - 目标设备
 * @returns 具有设备字段的事件
 */
function deviceEvent(type: string, device: unknown): Event {
  return Object.assign(new Event(type), { device });
}

describe("K20 GT 设备写入与释放", () => {
  it("只选择包含文字 Report 的目标设备，并合并并发连接", async () => {
    const { controller, device } = fixture();
    expect(isK20GT(device as unknown as HIDDevice)).toBe(true);
    expect(isK20GT({ ...device, productId: 1 } as unknown as HIDDevice)).toBe(false);
    expect(isK20GT({ ...device, collections: [] } as unknown as HIDDevice)).toBe(false);
    await Promise.all([controller.connect(), controller.connect()]);
    expect(device.open).toHaveBeenCalledOnce();
    await controller.dispose();
  });

  it("慢写入期间仅保留最新待发歌词，关闭时最后发送清屏", async () => {
    const { controller, device } = fixture();
    await controller.connect();
    let finish!: () => void;
    device.sendReport.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    controller.submit(encodeK20GTReport("第一句"));
    controller.submit(encodeK20GTReport("旧句"));
    controller.submit(encodeK20GTReport("最新句"));
    expect(device.sendReport).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(device.sendReport).toHaveBeenCalledTimes(2));
    expect(device.sendReport.mock.calls[1]).toEqual([0xbc, encodeK20GTReport("最新句")]);
    await controller.dispose();
    expect(device.sendReport).toHaveBeenLastCalledWith(0xbc, encodeK20GTReport(""));
    expect(device.close).toHaveBeenCalledOnce();
  });

  it("拔出设备丢弃待发内容，插回后重连且释放后不再响应插入", async () => {
    const { controller, device, hid, onStatus } = fixture();
    await controller.connect();
    hid.dispatchEvent(deviceEvent("disconnect", device));
    device.opened = false;
    controller.submit(encodeK20GTReport("旧句"));
    expect(device.sendReport).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith({ state: "disconnected" });
    hid.dispatchEvent(deviceEvent("connect", device));
    await controller.connect();
    expect(onStatus).toHaveBeenLastCalledWith({ state: "connected" });
    await controller.dispose();
    hid.dispatchEvent(deviceEvent("connect", device));
    expect(device.open).toHaveBeenCalledTimes(2);
  });

  it("设备写入失败后关闭句柄，并允许重新连接", async () => {
    const { controller, device, onStatus } = fixture();
    await controller.connect();
    device.sendReport.mockRejectedValueOnce(new Error("USB failed"));
    controller.submit(encodeK20GTReport("测试"));
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith({ state: "error", error: "Error: USB failed" }),
    );
    expect(device.opened).toBe(false);
    await controller.connect();
    expect(device.opened).toBe(true);
    await controller.dispose();
  });

  it("连接尚未完成时关闭，不遗留后来打开的句柄", async () => {
    const { controller, device, onStatus } = fixture();
    let finish!: () => void;
    device.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            device.opened = true;
            resolve();
          };
        }),
    );
    const connecting = controller.connect();
    await vi.waitFor(() => expect(device.open).toHaveBeenCalled());
    const closing = controller.dispose();
    finish();
    await Promise.all([connecting, closing]);
    expect(device.opened).toBe(false);
    expect(onStatus).not.toHaveBeenCalledWith({ state: "connected" });
  });
});
