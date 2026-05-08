import type { SettingCategory } from "@/types/settings-schema";
import generalCategory from "./categories/general";
import appearanceCategory from "./categories/appearance";
import playerCategory from "./categories/player";
import lyricCategory from "./categories/lyric";
import externalLyricCategory from "./categories/externalLyric";
import hotkeysCategory from "./categories/hotkeys";
import servicesCategory from "./categories/services";
import streamingCategory from "./categories/streaming";
import pluginsCategory from "./categories/plugins";

/** 设置项 schema：左侧分类（category）→ 区块（section）→ 设置项（item）三级结构。
 *  各 category 单独成文件，便于维护与定位。 */
export const settingsSchema: SettingCategory[] = [
  generalCategory,
  appearanceCategory,
  playerCategory,
  lyricCategory,
  externalLyricCategory,
  hotkeysCategory,
  servicesCategory,
  streamingCategory,
  pluginsCategory,
];
