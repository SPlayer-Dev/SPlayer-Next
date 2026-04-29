import type { Track } from "@shared/types/player";

/** 文件夹树节点 */
export interface FolderNode {
  /** 目录显示名 */
  name: string;
  /** 完整目录路径 */
  path: string;
  children: FolderNode[];
  /** 自身及子目录下的全部曲目 */
  tracks: Track[];
}
