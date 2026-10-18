/// <reference types="w3c-web-hid" />
import {
  K20GT_PRODUCT_ID,
  K20GT_REPORT_ID,
  K20GT_VENDOR_ID,
  encodeK20GTReport,
} from "@shared/utils/k20gt";
import type { K20GTStatus } from "@shared/types/k20gt";

/**
 * 判断是否为音箱的文字控制集合
 * @param device - 浏览器 HID 设备
 * @returns 是否包含目标输出报文
 */
export function isK20GT(device: HIDDevice): boolean {
  if (device.vendorId !== K20GT_VENDOR_ID || device.productId !== K20GT_PRODUCT_ID) return false;
  const pending = [...device.collections];
  while (pending.length) {
    const collection = pending.pop()!;
    if (collection.outputReports?.some((report) => report.reportId === K20GT_REPORT_ID))
      return true;
    pending.push(...(collection.children ?? []));
  }
  return false;
}

/** 串行发送，仅保留正在发送和最新待发的两条报文 */
export class K20GTController {
  private device: HIDDevice | null = null;
  private pending: Uint8Array | null = null;
  private draining: Promise<void> | null = null;
  private connecting: Promise<void> | null = null;
  private disposed = false;
  private epoch = 0;

  /**
   * 创建由专用设备页面持有的控制器
   * @param hid - 当前页面的 HID 入口
   * @param onStatus - 连接状态回调
   */
  constructor(
    private readonly hid: HID,
    private readonly onStatus: (status: K20GTStatus) => void,
  ) {
    hid.addEventListener("connect", this.onConnect);
    hid.addEventListener("disconnect", this.onDisconnect);
  }

  /**
   * 目标设备插入后尝试恢复连接
   * @param event - 设备插入事件
   */
  private onConnect = (event: HIDConnectionEvent): void => {
    if (isK20GT(event.device)) void this.connect();
  };

  /**
   * 拔出当前设备后丢弃旧歌词
   * @param event - 设备拔出事件
   */
  private onDisconnect = (event: HIDConnectionEvent): void => {
    if (event.device !== this.device) return;
    this.epoch++;
    this.device = null;
    this.pending = null;
    this.onStatus({ state: "disconnected" });
  };

  /**
   * 连接宿主已授权的目标设备，合并并发连接请求
   * @returns 连接流程结束后完成
   */
  connect(): Promise<void> {
    if (this.disposed || this.device?.opened) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** 获取已授权的控制集合并打开设备 */
  private async open(): Promise<void> {
    this.onStatus({ state: "connecting" });
    let device: HIDDevice | undefined;
    try {
      device = (await this.hid.getDevices()).find(isK20GT);
      if (this.disposed) return;
      if (!device) {
        this.onStatus({ state: "disconnected" });
        return;
      }
      await device.open();
      if (this.disposed) {
        await device.close();
        return;
      }
      this.device = device;
      this.epoch++;
      this.onStatus({ state: "connected" });
    } catch (error) {
      if (device?.opened) await device.close().catch(() => {});
      if (!this.disposed) this.onStatus({ state: "error", error: String(error) });
    }
  }

  /**
   * 合并等待发送的旧文字
   * @param report - 不含 Report ID 的报文
   */
  submit(report: Uint8Array): void {
    if (this.disposed || !this.device?.opened) return;
    this.pending = report;
    this.ensureDraining();
  }

  /** 启动写入，并接续完成边界到达的新报文 */
  private ensureDraining(): void {
    if (this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.pending) this.ensureDraining();
    });
  }

  /** 串行写入，失败时关闭设备并等待重新连接 */
  private async drain(): Promise<void> {
    while (this.pending && this.device) {
      const device = this.device;
      const epoch = this.epoch;
      const report = this.pending;
      this.pending = null;
      try {
        await device.sendReport(K20GT_REPORT_ID, new Uint8Array(report));
      } catch (error) {
        if (this.device !== device || epoch !== this.epoch) continue;
        this.device = null;
        this.pending = null;
        await device.close().catch(() => {});
        if (!this.disposed) this.onStatus({ state: "error", error: String(error) });
      }
    }
  }

  /** 停止接收更新，清屏并释放 USB 接口和设备事件 */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.hid.removeEventListener("connect", this.onConnect);
    this.hid.removeEventListener("disconnect", this.onDisconnect);
    this.pending = null;
    await this.connecting;
    await this.draining;
    const device = this.device;
    this.device = null;
    if (device?.opened) {
      try {
        await device.sendReport(K20GT_REPORT_ID, encodeK20GTReport(""));
      } finally {
        await device.close();
      }
    }
  }
}
