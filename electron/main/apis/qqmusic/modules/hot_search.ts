/**
 * 热搜关键词
 * module: tencent_musicsoso_hotkey.HotkeyService / GetHotkeyForQQMusicPC
 */

import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface HotItem {
  query?: string;
  title?: string;
  id?: number;
}

const hotSearch: QMModule = async () => {
  const data = await qmRequest<{ vec_hotkey?: HotItem[] }>(
    "tencent_musicsoso_hotkey.HotkeyService",
    "GetHotkeyForQQMusicPC",
    { search_id: "", uin: 0 },
    { auth: false },
  );

  const list = (data?.vec_hotkey ?? []).map((item) => ({
    keyword: item.query || item.title || "",
    id: item.id,
  }));

  return { code: 200, list };
};

export default hotSearch;
