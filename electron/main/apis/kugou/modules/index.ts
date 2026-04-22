/**
 * KG 模块注册表
 */

import type { KGModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";

export const modules: Record<string, KGModule> = {
  lyric,
  search,
};
