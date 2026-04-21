/**
 * 生成二维码登录 URL（可选返回 data URL 图像）
 *
 * 注：原实现依赖 qrcode 包生成图像；这里只返回 URL，
 * 渲染端可自行使用现成的 QR 生成器（更贴合 Electron 架构，避免再引入一个 Node 依赖）。
 */

import type { NeteaseModule } from "../core/types";

const loginQrCreate: NeteaseModule = async (query) => {
  const url = `https://music.163.com/login?codekey=${query.key}`;
  return {
    status: 200,
    body: {
      code: 200,
      data: { qrurl: url, qrimg: "" },
    },
    cookie: [],
  };
};

export default loginQrCreate;
