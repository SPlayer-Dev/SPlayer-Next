import type {
  MusicListenData,
  SheetInstrumentType,
  SheetListData,
  SongWikiAchievement,
  SongWikiBasicItem,
  SongWikiCreationItem,
  SongWikiSheet,
  SongWikiStory,
  SongWikiView,
  WikiData,
  WikiSubElement,
  WikiSubBlock,
} from "@/types/songWiki";
import { formatDateTime } from "@/utils/time";

/** 取主信息块（songDetailNewSongWiki）下的子块 */
const findSubBlocks = (wiki: WikiData | null, blockCode: string): WikiSubBlock[] => {
  const main = (wiki?.blocks ?? []).find((block) => block.positionCode === "songDetailNewSongWiki");
  return (main?.rnData?.blocks ?? []).filter((sub) => sub.blockCode === blockCode);
};

/** 取子块的展示元素 */
const findElements = (wiki: WikiData | null, blockCode: string): WikiSubElement[] =>
  findSubBlocks(wiki, blockCode).flatMap((sub) => sub.blockInfo?.wikiSubElementVos ?? []);

/** 元素文本：标签类取二级条目，文本类取 content */
const elementTexts = (element: WikiSubElement): string[] =>
  (element.wikiSubMetaVos ?? [])
    .map((meta) => meta.text?.trim())
    .filter((text): text is string => !!text);

/** 读取音乐简介（基本信息子块：曲风/语种/BPM/推荐标签等） */
const readBasicInfo = (wiki: WikiData | null): SongWikiBasicItem[] =>
  findElements(wiki, "wikiSubBlockBaseInfoVo")
    .filter((element) => element.title || element.content)
    .map((element) => {
      const tags = elementTexts(element);
      return {
        label: element.title ?? "",
        tags,
        text: element.content ?? undefined,
      };
    })
    .filter((item) => item.label && (item.tags.length > 0 || item.text));

/** 读取创作信息（子块：作词/作曲/编曲等人员信息） */
const readCreationInfo = (wiki: WikiData | null): SongWikiCreationItem[] =>
  findElements(wiki, "wikiSubBlockSongInfoVo")
    .filter((element) => element.title && elementTexts(element).length > 0)
    .map((element) => ({ label: element.title ?? "", names: elementTexts(element) }));

/** 读取成就条目（获奖记录 / 专辑荣誉 / 影视综艺） */
const readAchievements = (
  wiki: WikiData | null,
): {
  awards: SongWikiAchievement[];
  credentials: SongWikiAchievement[];
} => {
  const toItem = (element: WikiSubElement): SongWikiAchievement | null => {
    const title = element.title?.trim();
    if (!title) return null;
    const subTitle = [element.type, element.resourceType, element.subTitle]
      .filter((part): part is string => typeof part === "string" && !!part.trim())
      .join(" · ");
    return { title, subTitle: subTitle || undefined, image: element.imgUrl ?? undefined };
  };
  const awards = [
    ...findElements(wiki, "wikiSubBlockAwardRecordVo"),
    ...findElements(wiki, "wikiSubBlockAlbumAwardRecordVo"),
  ]
    .map(toItem)
    .filter((item): item is SongWikiAchievement => item !== null);
  const credentials = findElements(wiki, "wikiSubBlockEntertainmentVo")
    .map(toItem)
    .filter((item): item is SongWikiAchievement => item !== null);
  return { awards, credentials };
};

/** 乐谱元素的首个乐器类型 */
const firstInstrumentType = (
  element: Pick<WikiSubElement, "type">,
): SheetInstrumentType | undefined => (Array.isArray(element.type) ? element.type[0] : undefined);

/** 读取乐谱列表；构造式百科只返回部分乐谱，完整列表由 sheet_list 接口补齐 */
const readSheets = (wiki: WikiData | null): SongWikiSheet[] =>
  findElements(wiki, "wikiSubBlockSheetInfoVo")
    .filter((element) => typeof element.id === "number")
    .map((element) => {
      const instrument = firstInstrumentType(element);
      return {
        id: String(element.id),
        name: element.name ?? element.title,
        playVersion: element.playVersion,
        totalPageSize: element.totalPageSize,
        coverImageUrl: element.coverImageUrl,
        typeName: instrument?.name,
        typeIcon: instrument?.icon,
      };
    });

/**
 * 归一化乐谱列表接口数据
 * @param data - music/sheet/list/v1 的 data
 * @returns 乐谱条目
 */
export const normalizeSheetList = (data: SheetListData | null): SongWikiSheet[] =>
  (data?.musicSheetSimpleInfoVOS ?? [])
    .filter((item) => item.id != null)
    .map((item) => ({
      id: String(item.id),
      name: item.name,
      playVersion: item.playVersion,
      totalPageSize: item.totalPageSize,
      coverImageUrl: item.coverImageUrl,
      typeName: item.type?.[0]?.name,
      typeIcon: item.type?.[0]?.icon,
    }));

/** 读取相似歌曲 ID（相似歌曲块的 rnData.simSongs） */
const readSimilarIds = (wiki: WikiData | null): string[] => {
  const block = (wiki?.blocks ?? []).find((item) => item.positionCode === "songWikiSimSongs");
  const ids = new Set<string>();
  for (const song of block?.rnData?.simSongs ?? []) {
    if (song.id != null) ids.add(String(song.id));
  }
  return [...ids];
};

/** 读取音乐故事：构造块优先，个人聆听接口补充 */
const readStory = (wiki: WikiData | null, listen: MusicListenData | null): SongWikiStory | null => {
  const block = (wiki?.blocks ?? []).find((item) => item.positionCode === "songWikiFirstListen");
  const rn = block?.rnData;
  const listenFirst = listen?.musicFirstListenDto;
  const listenTotal = listen?.musicTotalPlayDto;
  const listenLike = listen?.musicLikeSongDto;
  const story: SongWikiStory = {};

  if (rn?.firstListen) {
    const first = rn.firstListen;
    const timestamp = listenFirst?.listenTime ?? first.timestamp;
    story.firstListen = {
      season: listenFirst?.season ?? first.season,
      period: listenFirst?.period ?? first.period,
      date: listenFirst?.date ?? (timestamp ? formatDateTime(timestamp) : undefined),
    };
  } else if (listenFirst) {
    story.firstListen = {
      season: listenFirst.season,
      period: listenFirst.period,
      date:
        listenFirst.date ??
        (listenFirst.listenTime ? formatDateTime(listenFirst.listenTime) : undefined),
    };
  }

  const total = listenTotal?.playCount != null ? listenTotal : rn?.totalPlay;
  if (total?.playCount != null) story.totalPlay = { playCount: total.playCount, text: total.text };

  if (listenLike?.like) story.likeSong = { text: listenLike.text, redDesc: listenLike.redDesc };

  return story.firstListen || story.totalPlay || story.likeSong ? story : null;
};

/**
 * 归一化歌曲百科数据
 * @param wiki - song_wiki_info（construct/info）的 data
 * @param listen - 个人聆听故事接口的 data，登录后补充红心收藏
 * @returns 页面视图模型
 */
export const normalizeSongWiki = (
  wiki: WikiData | null,
  listen: MusicListenData | null,
): SongWikiView => {
  const { awards, credentials } = readAchievements(wiki);
  return {
    story: readStory(wiki, listen),
    basicInfo: readBasicInfo(wiki),
    creationInfo: readCreationInfo(wiki),
    sheets: readSheets(wiki),
    awards,
    credentials,
    similarIds: readSimilarIds(wiki),
  };
};
