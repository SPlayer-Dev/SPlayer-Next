import type { LyricFormat } from "@shared/types/lyrics";

/**
 * 从歌词原始内容中提取「歌词文件制作者」
 * @param content - 歌词原始文本
 * @param format - 歌词格式
 */
export const extractLyricAuthor = (content: string, format: LyricFormat): string | null => {
  if (format === "ttml") {
    // 优先 GitHub 登录名
    const login = content.match(/key="ttmlAuthorGithubLogin"\s+value="([^"]*)"/)?.[1];
    const base = content.match(/key="ttmlAuthorGithub"\s+value="([^"]*)"/)?.[1];
    return (login || base || "").trim() || null;
  }
  if (format === "lrc") {
    return content.match(/\[by:([^\]]+)\]/i)?.[1]?.trim() || null;
  }
  return null;
};
