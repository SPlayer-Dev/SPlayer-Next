/** 嵌入健康校验需要执行的动作 */
export type EmbedAction = "idle" | "healthy" | "reattach" | "reembed";

/**
 * 根据原生探测结果决定是否需要自愈
 *
 * 任务栏歌词窗口的坐标是「相对任务栏」的（y=0 即任务栏顶边），父关系一旦失效，
 * 同一组坐标会被当作屏幕坐标解释，窗口会停在屏幕顶部且不会自行恢复
 * @param state - 原生探测结果（alive: HWND 是否仍有效；embedded: 是否仍挂在任务栏上）
 * @param currentHwnd - 窗口当前的 HWND
 * @param embeddedHwnd - 上次嵌入时记录的 HWND，null 表示尚未完成首次嵌入
 * @returns 需要执行的动作
 */
export const resolveEmbedAction = (
  state: { alive: boolean; embedded: boolean },
  currentHwnd: number,
  embeddedHwnd: number | null,
): EmbedAction => {
  if (embeddedHwnd === null) return "idle";
  // HWND 已失效：不对窗口做任何操作，交给 explorer 重启路径处理
  if (!state.alive) return "idle";
  if (currentHwnd !== embeddedHwnd) return "reembed";
  return state.embedded ? "healthy" : "reattach";
};
