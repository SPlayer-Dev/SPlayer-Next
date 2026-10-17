/**
 * 仅排除网易云已确认的整段缺失提示，避免误判正常歌词。
 * @param content - 网易云原始 LRC 或 YRC 文本
 * @returns 是否为非空且非占位的歌词文本
 */
export const hasNeteaseLyric = (content?: string): content is string =>
  !!content?.trim() && content.trim() !== "[00:00.00]暂无歌词";
