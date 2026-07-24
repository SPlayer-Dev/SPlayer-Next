/**
 * 歌曲动态封面 API
 *
 * @param id - 歌曲全局 id
 * @returns 视频 URL；无动态封面或失败返回 null
 */
export const songDynamicCover = async (id: string): Promise<string | null> => {
  const res = await window.api.apis.call("netease", "song/dynamic/cover", { id });
  if (!res.ok) return null;
  const body = (res.body ?? res.data) as Record<string, unknown> | undefined;
  if (!body) return null;
  // 嵌套 data.data.videoPlayUrl（与 SPlayer 一致）
  const inner = (body.data ?? body) as Record<string, unknown>;
  return (inner.videoPlayUrl as string) ?? null;
};
