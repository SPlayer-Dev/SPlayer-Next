export interface QQMusicCredential {
  musickey?: string;
  musicid?: number | string;
  str_musicid?: string;
  refresh_key?: string;
  refresh_token?: string;
  access_token?: string;
  encryptUin?: string;
  openid?: string;
  unionid?: string;
  expired_at?: number;
  musickeyCreateTime?: number;
  keyExpiresIn?: number;
  loginType?: number;
  nick?: string;
  nickname?: string;
  logo?: string;
  avatarUrl?: string;
}

/**
 * 生成发送给 QM 的 Cookie 请求头
 * @param session - 本地保存的 QM 会话
 * @returns Cookie 请求头；没有可发送字段时返回 undefined
 */
export const sessionToCookieHeader = (session: Record<string, string>): string | undefined => {
  const entries = Object.entries(session).filter(([_, value]) => !!value);
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${value}`).join("; ")
    : undefined;
};

/**
 * 获取凭据对应的真实音乐账号 ID
 * @param credential - QM 登录凭据
 * @param fallback - 未返回账号 ID 时的回退值
 * @returns 音乐账号 ID
 */
export const getCredentialMusicId = (credential: QQMusicCredential, fallback = ""): string =>
  String(credential.str_musicid || credential.musicid || fallback).replace(/^o/, "");

/**
 * 将登录凭据转换为持久化会话字段
 * @param credential - QM 登录凭据
 * @param loginType - 登录类型
 * @param fallbackMusicId - 未返回账号 ID 时的回退值
 * @returns 可持久化的会话字段
 */
export const credentialToSession = (
  credential: QQMusicCredential,
  loginType: 1 | 2,
  fallbackMusicId = "",
): Record<string, string> => {
  const musicId = getCredentialMusicId(credential, fallbackMusicId);
  const session: Record<string, string> = {
    uin: musicId,
    qm_str_musicid: musicId,
    qm_keyst: credential.musickey || "",
    qqmusic_key: credential.musickey || "",
    tmeLoginType: String(credential.loginType || loginType),
  };

  if (loginType === 1) session.wxuin = musicId;
  if (credential.encryptUin) session.euin = credential.encryptUin;
  if (credential.openid)
    session[loginType === 1 ? "wxopenid" : "psrf_qqopenid"] = credential.openid;
  if (credential.unionid) session.psrf_qqunionid = credential.unionid;
  if (credential.refresh_token)
    session[loginType === 1 ? "wxrefresh_token" : "psrf_qqrefresh_token"] =
      credential.refresh_token;
  if (credential.access_token) session.psrf_qqaccess_token = credential.access_token;
  if (credential.refresh_key) session.qm_refresh_key = credential.refresh_key;
  if (credential.expired_at) session.psrf_access_token_expiresAt = String(credential.expired_at);
  if (credential.musickeyCreateTime)
    session.psrf_musickey_createtime = String(credential.musickeyCreateTime);
  if (credential.keyExpiresIn) session.qm_key_expires_in = String(credential.keyExpiresIn);

  return session;
};
