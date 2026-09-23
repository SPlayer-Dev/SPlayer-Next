/**
 * QM 模块注册表
 */

import type { QMModule } from "../core/types";

import hot_search from "./hot_search";
import leaderboard from "./leaderboard";
import lyric from "./lyric";
import match from "./match";
import search from "./search";
import album from "./album";
import artist from "./artist";
import song_info from "./song_info";
import song_list from "./song_list";
import user_detail from "./user_detail";
import song_url from "./song_url";
import comment from "./comment";
import { login_qr_key, login_qr_check } from "./login_qr";

export const modules: Record<string, QMModule> = {
  hot_search,
  leaderboard,
  lyric,
  match,
  search,
  album,
  artist,
  song_info,
  song_list,
  user_detail,
  song_url,
  comment,
  login_qr_key,
  login_qr_check,
};
