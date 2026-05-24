/**
 * 网易云接口原始数据类型
 */

/** 歌手 */
export interface NeteaseArtist {
  id: number;
  name: string;
  /** 翻译名 */
  tns?: string[];
  /** 别名 */
  alias?: string[];
}

/** 专辑 */
export interface NeteaseAlbumLite {
  id: number;
  name: string;
  picUrl: string;
  /** 翻译名 */
  tns?: string[];
  /** picUrl 对应的字符串 ID */
  pic_str?: string;
  /** 发行时间（Unix ms） */
  publishTime?: number;
}

/** 单音质规格 */
export interface NeteaseQuality {
  /** 比特率（bps） */
  br: number;
  /** 文件 ID */
  fid: number;
  /** 文件大小（字节） */
  size: number;
  /** 音量增益 */
  vd: number;
  /** 采样率 */
  sr: number;
}

/** 试听权限 */
export interface NeteaseFreeTrialPrivilege {
  userConsumable: boolean;
  resConsumable: boolean;
}

/** 计费信息项 */
export interface NeteaseChargeInfo {
  rate: number;
  chargeType: number;
}

/** 歌曲级权限 */
export interface NeteasePrivilege {
  id: number;
  /** 0=免费 1=付费 4=未上架 8=低质 */
  fee: number;
  /** 是否已购：0=未购 1=已购 */
  payed: number;
  st: number;
  /** 播放等级 */
  pl: number;
  /** 下载等级 */
  dl: number;
  /** 试听最高 br */
  fl: number;
  flLevel: string;
  /** 播放最高 br */
  playMaxbr: number;
  playMaxBrLevel: string;
  /** 下载最高 br */
  downloadMaxbr: number;
  downloadMaxBrLevel: string;
  /** 综合最高 br */
  maxbr: number;
  maxBrLevel: string;
  plLevel: string;
  dlLevel: string;
  freeTrialPrivilege?: NeteaseFreeTrialPrivilege;
  chargeInfoList?: NeteaseChargeInfo[];
}

/**
 * 网易云歌曲对象
 */
export interface NeteaseSong {
  id: number;
  name: string;
  /** 翻译名（中英互译） */
  tns?: string[];
  /** 歌手列表 */
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  /** 专辑 */
  al?: NeteaseAlbumLite;
  album?: NeteaseAlbumLite;
  /** 时长，毫秒 */
  dt?: number;
  duration?: number;
  /** 别名 */
  alia?: string[];
  /** 别名 */
  alias?: string[];
  /** 高音质（320k） */
  h?: NeteaseQuality | null;
  /** 中音质（192k） */
  m?: NeteaseQuality | null;
  /** 低音质（128k） */
  l?: NeteaseQuality | null;
  /** 无损 */
  sq?: NeteaseQuality | null;
  /** Hi-Res */
  hr?: NeteaseQuality | null;
  /** 版权 */
  fee?: number;
  /** 流行度 0-100 */
  pop?: number;
  /** MV ID，0 表示无 */
  mv?: number;
  /** 版权 ID */
  copyright?: number;
  /** CD 编号 */
  cd?: string;
  /** 碟内序号 */
  no?: number;
  /** 位标识（VIP、付费试听等位标） */
  mark?: number;
  /** 发行时间（Unix ms），song 顶层有时也会返回 */
  publishTime?: number;
  /** 歌曲级权限 */
  privilege?: NeteasePrivilege;
  /** 用户云盘信息 */
  pc?: NeteasePrivateCloud | null;
}

/** 用户云盘私有信息 */
export interface NeteasePrivateCloud {
  /** 文件名 */
  fn?: string;
  md5?: string;
  /** 比特率 */
  br?: number;
  /** 上传时的歌手名 */
  ar?: string;
  /** 上传时的专辑名 */
  alb?: string;
  /** 歌曲名 */
  sn?: string;
  cid?: string;
  cf?: number;
  vd?: number;
  st?: number;
}
