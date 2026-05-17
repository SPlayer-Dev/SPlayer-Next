/**
 * Netease API 模块注册表
 *
 * 每新增一个 module，在这里用一行 import + export 接入即可。
 * 运行时通过 `callNetease(name, params)` 按 key 路由。
 */

import type { NeteaseModule } from "../core/types";

// 登录 / 会话
import captcha_sent from "./captcha_sent";
import captcha_verify from "./captcha_verify";
import login from "./login";
import login_cellphone from "./login_cellphone";
import login_qr_check from "./login_qr_check";
import login_qr_create from "./login_qr_create";
import login_qr_key from "./login_qr_key";
import login_refresh from "./login_refresh";
import login_status from "./login_status";
import logout from "./logout";
import register_anonimous from "./register_anonimous";

// 用户
import user_account from "./user_account";
import user_cloud from "./user_cloud";
import user_detail from "./user_detail";
import user_detail_new from "./user_detail_new";
import user_followeds from "./user_followeds";
import user_follows from "./user_follows";
import user_level from "./user_level";
import user_playlist from "./user_playlist";
import user_record from "./user_record";
import user_subcount from "./user_subcount";

// 搜索
import cloudsearch from "./cloudsearch";
import search from "./search";
import search_default from "./search_default";
import search_hot from "./search_hot";
import search_hot_detail from "./search_hot_detail";
import search_match from "./search_match";
import search_multimatch from "./search_multimatch";
import search_suggest from "./search_suggest";
import search_suggest_pc from "./search_suggest_pc";

// 歌词
import lyric from "./lyric";
import lyric_new from "./lyric_new";
import cloud_lyric_get from "./cloud_lyric_get";

// 播放
import song_detail from "./song_detail";
import song_url from "./song_url";

// 歌单 / 喜欢
import playlist_detail from "./playlist_detail";
import likelist from "./likelist";
import like from "./like";

// 专辑
import album from "./album";

// 歌手
import artists from "./artists";
import artist_album from "./artist_album";
import artist_songs from "./artist_songs";

// 用户收藏
import album_sublist from "./album_sublist";
import artist_sublist from "./artist_sublist";

export const modules: Record<string, NeteaseModule> = {
  captcha_sent,
  captcha_verify,
  login,
  login_cellphone,
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_refresh,
  login_status,
  logout,
  register_anonimous,

  user_account,
  user_cloud,
  user_detail,
  user_detail_new,
  user_followeds,
  user_follows,
  user_level,
  user_playlist,
  user_record,
  user_subcount,

  cloudsearch,
  search,
  search_default,
  search_hot,
  search_hot_detail,
  search_match,
  search_multimatch,
  search_suggest,
  search_suggest_pc,

  lyric,
  lyric_new,
  cloud_lyric_get,

  song_detail,
  song_url,

  playlist_detail,
  likelist,
  like,

  album,

  artists,
  artist_album,
  artist_songs,

  album_sublist,
  artist_sublist,
};
