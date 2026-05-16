/**
 * 生成二维码登录 URL（可选返回 data URL 图像）
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
