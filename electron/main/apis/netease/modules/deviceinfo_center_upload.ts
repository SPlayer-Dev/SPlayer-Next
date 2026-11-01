/**
 * 上报登录设备名称
 *
 * 官方客户端在登录成功后调用，用于「登录设备管理」展示自定义名称
 *
 * params:
 * - deviceName 设备名，缺省为「用户名 的 计算机名」
 *
 * 响应：`{ code }`，成功为 200
 */

import { hostname, userInfo } from "node:os";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/** 与官方客户端一致的设备名，取不到用户名时退化为计算机名 */
const defaultDeviceName = (): string => {
  const user = userInfo().username.trim();
  const host = hostname();
  return user ? `${user} 的 ${host}` : host;
};

const deviceinfoCenterUpload: NeteaseModule = async (query, request) => {
  const deviceName = String(query.deviceName ?? "").trim() || defaultDeviceName();
  return request("/api/deviceinfo/center/upload", { deviceName }, createOption(query, "eapi"));
};

export default deviceinfoCenterUpload;
