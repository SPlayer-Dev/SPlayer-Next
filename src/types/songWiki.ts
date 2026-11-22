import type { Track } from "@shared/types/player";

/**
 * 歌曲百科数据结构。
 * song_wiki_info（construct/info）返回「构造式」布局：
 * data.blocks[] 按 positionCode 分块，内容嵌在 block.rnData 里，
 * 子块按 blockCode 组织，元素在 blockInfo.wikiSubElementVos[]。
 * 字段依据 2026 实测响应（晴天 186016 / 起风了 1330348068）整理，均为可空。
 */

/** 构造式百科 data */
export interface WikiData {
  blocks?: WikiConstructBlock[];
}

/** 构造式顶层块，按 positionCode 区分内容 */
export interface WikiConstructBlock {
  /** 块位置码，如 songDetailNewSongWiki / songWikiFirstListen / songWikiSimSongs */
  positionCode?: string;
  /** 块内容，不同 positionCode 下结构不同 */
  rnData?: {
    /** 主信息块的子块列表 */
    blocks?: WikiSubBlock[];
    /** 回忆坐标块：第一次听 */
    firstListen?: {
      moduleTitle?: string;
      timestamp?: number;
      season?: string;
      period?: string;
      time?: string;
    };
    /** 回忆坐标块：累计播放 */
    totalPlay?: {
      moduleTitle?: string;
      playCount?: number;
      duration?: number;
      text?: string;
    };
    imageUrl?: string;
    targetUrl?: string;
    /** 相似歌曲 */
    simSongs?: {
      id?: number | string;
      name?: string;
      artists?: { name?: string }[];
    }[];
  };
}

/** 主信息块的子块 */
export interface WikiSubBlock {
  /** 子块码，如 wikiSubBlockBaseInfoVo / wikiSubBlockSheetInfoVo */
  blockCode?: string;
  blockInfo?: {
    blockCode?: number;
    blockName?: string | null;
    totalNum?: number | null;
    /** 该子块的展示元素列表 */
    wikiSubElementVos?: WikiSubElement[];
  };
}

/** 子块元素，基本信息/创作信息/获奖/影视/乐谱共用，不同 blockCode 下填充的字段不同 */
export interface WikiSubElement {
  /** 元素类型模式，0=文本值 1/7=标签 2=条目 3=影视 4=人员 */
  pattern?: number;
  title?: string;
  subTitle?: string | null;
  content?: string | null;
  imgUrl?: string | null;
  /** 条目类型；影视类为字符串，乐谱类为乐器类型数组 */
  type?: string | SheetInstrumentType[] | null;
  /** 资源类型，如影视的「插曲」「主题曲」 */
  resourceType?: string | null;
  id?: number | null;
  /** 二级条目（如曲风下的风格、推荐标签） */
  wikiSubMetaVos?: { id?: number | null; text?: string; imgUrl?: string | null }[] | null;
  /** 乐谱名称，如「钢琴、小提琴谱」 */
  name?: string;
  /** 演奏版本，如「弹唱版」「演奏版」 */
  playVersion?: string;
  /** 乐谱总页数 */
  totalPageSize?: number;
  /** 乐谱封面图 */
  coverImageUrl?: string;
  /** 难度，如「中」 */
  difficulty?: string;
  /** 调号，如「G」 */
  musicKey?: string;
  /** 每分钟节拍数 */
  bpm?: number;
}

/** music_first_listen_info 的故事 DTO，登录后返回，补充红心收藏 */
export interface MusicListenData {
  musicFirstListenDto?: {
    season?: string;
    period?: string;
    date?: string;
    listenTime?: number;
    meetDurationDesc?: string;
  };
  musicTotalPlayDto?: {
    playCount?: number;
    text?: string;
  };
  musicLikeSongDto?: {
    like?: boolean;
    text?: string;
    redDesc?: string;
  };
}

/** 视图层音乐故事 */
export interface SongWikiStory {
  firstListen?: {
    season?: string;
    period?: string;
    date?: string;
  };
  totalPlay?: {
    playCount: number;
    text?: string;
  };
  likeSong?: {
    text?: string;
    redDesc?: string;
  };
}

/** 视图层音乐简介条目（曲风/语种/BPM 等） */
export interface SongWikiBasicItem {
  /** 展示标签，如「曲风」「语种」 */
  label: string;
  /** 标签值列表（标签类元素） */
  tags: string[];
  /** 纯文本值（语种 / BPM 等） */
  text?: string;
}

/** 视图层创作信息条目（作词/作曲/编曲等） */
export interface SongWikiCreationItem {
  /** 角色，如「作词」「作曲」 */
  label: string;
  /** 人员文本列表 */
  names: string[];
}

/** 乐谱乐器类型，如「吉他」「钢琴」「总谱」 */
export interface SheetInstrumentType {
  code?: number;
  name?: string;
  icon?: string;
}

/** music/sheet/list/v1 的 data */
export interface SheetListData {
  /** 该歌曲的全部乐谱 */
  musicSheetSimpleInfoVOS?: SheetSimpleInfo[];
  /** 乐器类型字典 */
  sheetInstrumentTypeVOList?: SheetInstrumentType[];
  errorCode?: unknown;
  findSheet?: number;
  uploadSheet?: number;
}

/** 乐谱列表接口中的单条乐谱 */
export interface SheetSimpleInfo {
  id?: number | string;
  name?: string;
  type?: SheetInstrumentType[] | null;
  coverImageUrl?: string;
  totalPageSize?: number;
  difficulty?: string;
  musicKey?: string;
  playVersion?: string;
  bpm?: number;
}

/** 视图层乐谱条目 */
export interface SongWikiSheet {
  id: string;
  name?: string;
  playVersion?: string;
  totalPageSize?: number;
  coverImageUrl?: string;
  /** 乐器类型名称，如「吉他」「钢琴」 */
  typeName?: string;
  /** 乐器类型图标 */
  typeIcon?: string;
}

/** 视图层成就 / 影视综艺条目 */
export interface SongWikiAchievement {
  title: string;
  subTitle?: string;
  image?: string;
}

/** 百科页面视图模型 */
export interface SongWikiView {
  story: SongWikiStory | null;
  basicInfo: SongWikiBasicItem[];
  creationInfo: SongWikiCreationItem[];
  sheets: SongWikiSheet[];
  awards: SongWikiAchievement[];
  credentials: SongWikiAchievement[];
  similarIds: string[];
}

/** 头部所需的歌曲信息（来自 song_detail） */
export interface WikiSong {
  track: Track;
  publishTime?: number;
}

/** 乐谱预览页 */
export interface SheetPreviewPage {
  id?: number;
  url?: string;
}
