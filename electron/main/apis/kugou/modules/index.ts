/**
 * KG 模块注册表
 */

import type { KGModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import album from "./album";
import artist from "./artist";
import playlist from "./playlist";
import userDetail from "./user_detail";
import { loginQrCheck, loginQrKey } from "./login_qr";
import songUrl from "./song_url";
import comment from "./comment";

export const modules: Record<string, KGModule> = {
  lyric,
  search,
  album,
  artist,
  playlist,
  song_list: playlist,
  user_detail: userDetail,
  login_qr_key: loginQrKey,
  login_qr_check: loginQrCheck,
  song_url: songUrl,
  comment,
};
