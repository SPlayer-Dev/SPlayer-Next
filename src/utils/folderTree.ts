import type { Track } from "@shared/types/player";
import type { FolderNode } from "@/types/folder";

/**
 * 路径分隔归一化为正斜杠
 * @param p 路径
 * @returns 归一化后的路径
 */
const normalizePath = (p: string): string => p.replace(/\\/g, "/");

/**
 * 取目录名
 * @param p 路径
 * @returns 目录名
 */
const folderBasename = (p: string): string => {
  const norm = normalizePath(p).replace(/\/$/, "");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
};

/**
 * 把扁平的曲目列表按磁盘目录结构构建成森林
 * - 以 scanDirs 作为森林根（最长前缀匹配）
 * - 不在任何扫描根下的曲目挂到虚拟根 "/"
 * - 每个 FolderNode 的 tracks 字段累积自身及子目录下的全部曲目
 * @param tracks 曲目列表
 * @param scanDirs 扫描目录列表
 * @returns 文件夹树
 */
export const buildFolderTree = (
  tracks: readonly Track[],
  scanDirs: readonly string[],
): FolderNode[] => {
  if (tracks.length === 0) return [];
  const roots = new Map<string, FolderNode>();
  const folderIndex = new Map<string, FolderNode>();

  const findScanRoot = (trackPath: string): string => {
    const norm = normalizePath(trackPath);
    let matched = "";
    for (const dir of scanDirs) {
      const dirNorm = normalizePath(dir).replace(/\/$/, "");
      if (norm.startsWith(dirNorm + "/") && dirNorm.length > matched.length) {
        matched = dirNorm;
      }
    }
    return matched || "/";
  };

  const ensureFolder = (folderPath: string, name: string): FolderNode => {
    let node = folderIndex.get(folderPath);
    if (!node) {
      node = { name, path: folderPath, children: [], tracks: [] };
      folderIndex.set(folderPath, node);
    }
    return node;
  };

  for (const track of tracks) {
    if (!track.path) continue;
    const fullPath = normalizePath(track.path);
    const rootPath = findScanRoot(track.path);
    const rootNode =
      roots.get(rootPath) ?? ensureFolder(rootPath, folderBasename(rootPath) || rootPath);
    if (!roots.has(rootPath)) roots.set(rootPath, rootNode);

    const relative =
      rootPath === "/" ? fullPath.replace(/^\//, "") : fullPath.slice(rootPath.length + 1);
    const segments = relative.split("/").filter(Boolean);
    // 最后一段是文件名，去掉后剩下的就是文件夹链
    segments.pop();

    let parent: FolderNode = rootNode;
    let cumulativePath = rootPath;
    for (const seg of segments) {
      cumulativePath = cumulativePath === "/" ? "/" + seg : cumulativePath + "/" + seg;
      let child = parent.children.find((c) => c.path === cumulativePath);
      if (!child) {
        child = ensureFolder(cumulativePath, seg);
        parent.children.push(child);
      }
      parent = child;
    }
    // 自下而上把曲目累计到所有祖先文件夹
    let cursor: FolderNode | undefined = parent;
    while (cursor) {
      cursor.tracks.push(track);
      if (cursor === rootNode) break;
      const cur = normalizePath(cursor.path);
      const parentPath = cur.slice(0, Math.max(0, cur.lastIndexOf("/")));
      cursor = folderIndex.get(parentPath);
    }
  }

  // 自然排序
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sortChildren = (node: FolderNode): void => {
    node.children.sort((a, b) => collator.compare(a.name, b.name));
    for (const child of node.children) sortChildren(child);
  };
  const result = [...roots.values()];
  result.sort((a, b) => collator.compare(a.name, b.name));
  for (const root of result) sortChildren(root);
  return result;
};

/** 统计文件夹总数（递归） */
export const countFolders = (tree: readonly FolderNode[]): number => {
  let count = 0;
  const walk = (nodes: readonly FolderNode[]): void => {
    for (const node of nodes) {
      count++;
      walk(node.children);
    }
  };
  walk(tree);
  return count;
};
