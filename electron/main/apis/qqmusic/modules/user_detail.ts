/**
 * QM 用户基础资料模块
 *
 * 通过 music.UserInfo.userInfoServer / GetLoginUserInfo 获取用户信息
 */

import { clearQQMusicCookies, getQQMusicCookies, getQQMusicUin, qmRequest } from "../core/request";
import { normalizeQQMusicVip, type QQMusicVipData } from "../core/vip";
import { coreLog } from "@main/utils/logger";
import type { QMModule } from "../core/types";

interface ProfileCreator {
  nick?: string;
  headpic?: string;
}

/** 获取用户信息 */
const fetchCgiProfile = async (): Promise<ProfileCreator | null> => {
  try {
    const data = await qmRequest<{
      info?: {
        nick?: string;
        nickname?: string;
        name?: string;
        logo?: string;
      };
    }>("music.UserInfo.userInfoServer", "GetLoginUserInfo", {});
    const info = data?.info;
    if (info && (info.nick || info.nickname || info.name || info.logo)) {
      return {
        nick: info.nick || info.nickname || info.name,
        headpic: info.logo,
      };
    }
  } catch (err) {
    coreLog.warn("[qm-user-detail] GetLoginUserInfo 接口请求失败:", err);
  }
  return null;
};

/** 获取当前账号的会员播放权限 */
const fetchVipStatus = async (): Promise<QQMusicVipData | null> => {
  try {
    return await qmRequest<QQMusicVipData>("VipLogin.VipLoginInter", "vip_login_base", {});
  } catch (err) {
    coreLog.warn("[qm-user-detail] vip_login_base 接口请求失败:", err);
    return null;
  }
};

const userDetail: QMModule = async (_params) => {
  const uin = getQQMusicUin();
  const cookies = getQQMusicCookies();

  const hasKey = !!(
    cookies.qm_keyst ||
    cookies.qqmusic_key ||
    cookies.pskey ||
    cookies.p_skey ||
    cookies.skey
  );

  if (!uin || uin === "0" || !hasKey) {
    return {
      code: 301,
      loggedIn: false,
      message: "未登录 QM 账号",
    };
  }

  const [creator, vipData] = await Promise.all([fetchCgiProfile(), fetchVipStatus()]);

  // 若接口双双彻底失败（说明凭据已过期且自动续期失败）
  if (!creator && !vipData) {
    coreLog.warn("[qm-user-detail] 凭据已失效，清除 QM 会话");
    clearQQMusicCookies();
    return {
      code: 301,
      loggedIn: false,
      message: "QM 登录已过期，请重新登录",
    };
  }

  const avatarUrl = creator?.headpic?.replace(/^http:\/\//, "https://");
  const nickname = creator?.nick || "";
  const vip = normalizeQQMusicVip(vipData);

  return {
    code: 200,
    loggedIn: true,
    profile: {
      userId: uin,
      nickname,
      avatarUrl: avatarUrl || "",
      isVip: vip.isVip,
      vipLevel: vip.vipLevel,
    },
  };
};

export default userDetail;
