/**
 * 流媒体相关 IPC：仅提供"拉远端字节"能力给 SMTC 高清封面。
 *
 * 服务器配置、网络调用、列表/搜索/歌词等全部在渲染层完成。
 */
import { ipcMain } from "electron";
import { fetchBytes } from "@main/utils/fetchBytes";

export const registerStreamingIpc = (): void => {
  ipcMain.handle("streaming:fetchCoverBytes", async (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { success: false, error: "无效的 URL" };
    }
    const buf = await fetchBytes(url);
    return { success: true, data: buf };
  });
};
