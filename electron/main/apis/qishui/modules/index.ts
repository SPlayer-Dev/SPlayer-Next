import search from "./search";
import lyric from "./lyric";
import type { QSModule } from "../core/types";

/** QS 模块注册表 */
export const modules: Record<string, QSModule> = { search, lyric };
