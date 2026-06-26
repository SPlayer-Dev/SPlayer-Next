/**
 * GitHub 仓库相关接口
 */

/** 贡献者信息 */
export interface Contributor {
  /** 用户名 */
  login: string;
  /** 主页地址 */
  htmlUrl: string;
  /** 头像地址 */
  avatar: string;
}

/* 仓库标识 */
const repoSlug = "SPlayer-Dev/SPlayer-Next";

/**
 * 额外开发人员（未通过 GitHub Contributors API 展示的贡献者）
 * 按 login 去重，API 已返回的同名贡献者优先
 */
const additionalDevelopers: Contributor[] = [
  {
    login: "Fantasy-XY808",
    htmlUrl: "https://github.com/Fantasy-XY808",
    avatar: "https://github.com/Fantasy-XY808.png",
  },
];

/**
 * 获取仓库贡献者列表
 * 合并 GitHub Contributors API 与手动维护的额外开发人员，按 login 去重
 * @returns 贡献者数组
 */
export const getContributors = async (): Promise<Contributor[]> => {
  let apiContributors: Contributor[] = [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoSlug}/contributors?per_page=100&anon=true`,
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      apiContributors = data
        .filter((item) => item.type !== "Bot" && item.login !== "type-bot")
        .map((item) => ({
          login: item.login ?? item.name ?? "anonymous",
          htmlUrl: item.html_url ?? "",
          avatar: item.avatar_url ?? "",
        }));
    }
  } catch (error) {
    // 网络异常或速率受限时仅返回额外开发人员，保证手动维护的名单始终可见
    console.warn("[github] 获取贡献者失败，仅展示额外开发人员:", error);
  }
  const existingLogins = new Set(apiContributors.map((c) => c.login.toLowerCase()));
  return [
    ...apiContributors,
    ...additionalDevelopers.filter((d) => !existingLogins.has(d.login.toLowerCase())),
  ];
};
