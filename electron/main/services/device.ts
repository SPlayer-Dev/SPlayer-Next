import { sendToMain } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";
import type { AudioPlayer, JsPlayerEvent } from "@splayer/audio-engine";

/**
 * 消费 Rust 原生 endpoint 通知并刷新渲染进程设备状态。
 * @param player - 当前原生播放器实例
 * @param event - 原生设备事件
 */
export const handleNativeDeviceEvent = (player: AudioPlayer, event: JsPlayerEvent): void => {
  const devices = player.getOutputDevices();
  const defaultDevice = devices.find((device) => device.isDefault) ?? null;
  playerLog.info(
    `原生音频设备事件: ${event.deviceEvent ?? "unknown"}`,
    event.deviceId ?? "",
  );
  sendToMain("player:event", {
    type: "deviceChanged",
    data: {
      kind: event.deviceEvent ?? "unknown",
      deviceId: event.deviceId ?? null,
      defaultDeviceId: defaultDevice?.id ?? null,
      defaultDeviceName: defaultDevice?.name ?? null,
    },
  });
};
