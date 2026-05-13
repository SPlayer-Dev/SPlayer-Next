/**
 * PlaySessionId 生成器
 * Jellyfin/Emby stream URL 需要带 PlaySessionId 参数
 * 用来在 server 端区分相邻两次解码上下文。trackId 不变则复用同一个 UUID
 */

let lastPlaySession: { trackId: string; sessionId: string } | null = null;

/**
 * 取或生成 PlaySessionId，trackId 不变则复用
 * @param trackId - Track 全局 id
 * @returns PlaySessionId（UUID）
 */
export const sessionIdForTrack = (trackId: string): string => {
  if (lastPlaySession?.trackId === trackId) return lastPlaySession.sessionId;
  const sessionId = crypto.randomUUID();
  lastPlaySession = { trackId, sessionId };
  return sessionId;
};
