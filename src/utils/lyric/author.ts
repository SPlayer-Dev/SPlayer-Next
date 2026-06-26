import type { LyricFormat } from "@shared/types/lyrics";

/**
 * 从歌词原始内容中提取「歌词文件制作者」列表
 * @param content - 歌词原始文本
 * @param format - 歌词格式
 * @returns 作者账号/名称的数组
 */
export const extractLyricAuthors = (content: string, format: LyricFormat): string[] => {
  if (format === "ttml") {
    // 优先提取 ttmlAuthorGithubLogin，作为可以直接用于跳转 GitHub 的账号
    const logins = [...content.matchAll(/key="ttmlAuthorGithubLogin"\s+value="([^"]*)"/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    if (logins.length > 0) {
      return Array.from(new Set(logins));
    }
    // 如果无 login 标识，从 ttmlAuthorGithub 主页链接中截取最后的用户名
    const bases = [...content.matchAll(/key="ttmlAuthorGithub"\s+value="([^"]*)"/g)]
      .map((m) => {
        const val = m[1].trim();
        const parts = val.split("/");
        return parts[parts.length - 1] || val;
      })
      .filter(Boolean);
    return Array.from(new Set(bases));
  }
  if (format === "lrc") {
    const match = content.match(/\[by:([^\]]+)\]/i)?.[1]?.trim();
    return match ? [match] : [];
  }
  return [];
};
