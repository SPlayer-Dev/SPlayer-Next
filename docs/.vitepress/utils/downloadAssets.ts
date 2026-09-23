export interface DownloadAsset {
  fileName: string;
  url: string;
  size: number;
  platform: string;
  arch: string;
  format: string;
}

const LINUX_FORMATS = [
  { suffix: ".appimage", format: "AppImage" },
  { suffix: ".deb", format: "deb" },
  { suffix: ".rpm", format: "rpm" },
  { suffix: ".pacman", format: "pacman" },
  { suffix: ".tar.gz", format: "tar.gz" },
];

const FORMAT_ORDER = [
  "installer",
  "dmg",
  "AppImage",
  "deb",
  "rpm",
  "pacman",
  "portable",
  "zip",
  "tar.gz",
];

/**
 * 将默认安装方式排在便携版和压缩包之前
 * @param assets - 全部可下载资源
 * @returns 按推荐优先级排序后的新数组
 */
export const sortDownloadAssets = (assets: DownloadAsset[]): DownloadAsset[] => {
  return [...assets].sort((left, right) => {
    const leftIndex = FORMAT_ORDER.indexOf(left.format);
    const rightIndex = FORMAT_ORDER.indexOf(right.format);
    return leftIndex - rightIndex;
  });
};

/**
 * 识别发布资源的平台、架构与安装包格式
 * @param name - 发布资源文件名
 * @param url - 资源下载地址
 * @param size - 资源大小
 * @returns 可下载的安装包信息，非安装包返回 null
 */
export const parseDownloadAsset = (
  name: string,
  url: string,
  size: number,
): DownloadAsset | null => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blockmap") || lower.endsWith(".yml") || lower.includes("debug")) {
    return null;
  }

  let platform = "";
  let format = "";
  if (lower.endsWith(".exe")) {
    platform = "Windows";
    format = lower.includes("portable") ? "portable" : "installer";
  } else if (lower.endsWith(".dmg") || lower.endsWith(".zip")) {
    platform = "macOS";
    format = lower.endsWith(".dmg") ? "dmg" : "zip";
  } else {
    const linuxFormat = LINUX_FORMATS.find((item) => lower.endsWith(item.suffix));
    if (!linuxFormat) return null;
    platform = "Linux";
    ({ format } = linuxFormat);
  }

  let arch = "universal";
  if (lower.includes("arm64") || lower.includes("aarch64")) arch = "ARM64";
  else if (lower.includes("x64") || lower.includes("amd64") || lower.includes("x86_64")) {
    arch = "x64";
  }
  return { fileName: name, url, size, platform, arch, format };
};

/**
 * 根据系统和架构选择推荐资源；Linux 无法可靠识别发行版，因此只推荐通用 AppImage
 * @param assets - 全部可下载资源
 * @param platform - 用户操作系统
 * @param arch - 用户架构
 * @returns 最多两个推荐资源
 */
export const selectRecommendedAssets = (
  assets: DownloadAsset[],
  platform: string,
  arch: string,
): DownloadAsset[] => {
  if (!platform) return [];
  const samePlatform = assets.filter((asset) => asset.platform === platform);
  const matched = arch
    ? samePlatform.filter((asset) => asset.arch === arch || asset.arch === "universal")
    : samePlatform;
  const candidates = sortDownloadAssets(matched.length ? matched : samePlatform);
  if (platform === "Linux") {
    const appImages = candidates.filter((asset) => asset.format === "AppImage");
    return (appImages.length ? appImages : candidates).slice(0, 1);
  }
  return candidates.slice(0, 2);
};
