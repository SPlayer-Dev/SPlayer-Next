export interface DeviceChangeDecision {
  defaultChanged: boolean;
  shouldReinit: boolean;
}

/** 根据默认设备和用户选择决定是否重建音频输出 */
export const evaluateDeviceChange = (
  previousDefault: string | null,
  currentDefault: string | null,
  selectedDevice: string | null,
): DeviceChangeDecision => {
  const defaultChanged = previousDefault !== currentDefault;
  return {
    defaultChanged,
    shouldReinit: defaultChanged && currentDefault !== null && selectedDevice === null,
  };
};
