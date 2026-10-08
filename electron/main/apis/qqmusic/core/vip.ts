interface QQMusicVipIdentity {
  vip?: number;
  HugeVip?: number;
  huge_vip?: number;
  ExpVip?: number;
  exp_vip?: number;
  GroupVipFlag?: number;
  group_vip_flag?: number;
  CPLoverFlag?: number;
  cp_lover_flag?: number;
  level?: number;
}

export interface QQMusicVipData {
  svip?: number;
  identity?: QQMusicVipIdentity;
  userinfo?: {
    music_level?: number;
  };
}

/**
 * 将 QM 会员响应归一为播放权限状态
 * @param data - vip_login_base 响应
 * @returns 是否具有会员播放权限及会员等级
 */
export const normalizeQQMusicVip = (
  data: QQMusicVipData | null,
): { isVip: boolean; vipLevel: number } => {
  const identity = data?.identity;
  const flags = [
    data?.svip,
    identity?.vip,
    identity?.HugeVip,
    identity?.huge_vip,
    identity?.ExpVip,
    identity?.exp_vip,
    identity?.GroupVipFlag,
    identity?.group_vip_flag,
    identity?.CPLoverFlag,
    identity?.cp_lover_flag,
  ];
  return {
    isVip: flags.some((value) => Number(value) > 0),
    vipLevel: Number(identity?.level || data?.userinfo?.music_level || 0),
  };
};
