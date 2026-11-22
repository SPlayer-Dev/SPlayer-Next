import { describe, expect, it } from "vitest";
import type { MusicListenData, WikiData } from "@/types/songWiki";
import { normalizeSheetList, normalizeSongWiki } from "./songWiki";
import { formatDateTime } from "./time";

/** 依据 2026 实测 construct/info 响应的 fixture（晴天 186016 / 起风了 1330348068） */
const buildWiki = (overrides?: Partial<WikiData>): WikiData => {
  const base: WikiData = {
    blocks: [
      {
        positionCode: "songDetailNewSongWiki",
        rnData: {
          blocks: [
            {
              blockCode: "wikiSubBlockBaseInfoVo",
              blockInfo: {
                blockName: "基本信息",
                wikiSubElementVos: [
                  {
                    pattern: 1,
                    title: "曲风",
                    wikiSubMetaVos: [{ id: 1020, text: "流行-华语流行" }],
                  },
                  {
                    pattern: 7,
                    title: "推荐标签",
                    wikiSubMetaVos: [{ text: "治愈" }, { text: "KTV" }],
                  },
                  { pattern: 0, title: "语种", content: "国语" },
                  { pattern: 0, title: "BPM", content: "69" },
                ],
              },
            },
            {
              blockCode: "wikiSubBlockSongInfoVo",
              blockInfo: {
                blockName: "创作信息",
                wikiSubElementVos: [
                  { pattern: 4, title: "作词", wikiSubMetaVos: [{ text: "周杰伦" }] },
                  { pattern: 4, title: "作曲", wikiSubMetaVos: [{ text: "周杰伦" }] },
                ],
              },
            },
            {
              blockCode: "wikiSubBlockAwardRecordVo",
              blockInfo: {
                totalNum: 1,
                wikiSubElementVos: [
                  {
                    title: "第2届hito流行音乐奖",
                    subTitle: "Hito年度华语歌曲",
                    imgUrl: "https://p6.music.126.net/award.png",
                    content: "获",
                  },
                ],
              },
            },
            {
              blockCode: "wikiSubBlockEntertainmentVo",
              blockInfo: {
                totalNum: 1,
                wikiSubElementVos: [
                  {
                    title: "综艺《乘风破浪》插曲",
                    type: "综艺",
                    resourceType: "插曲",
                    imgUrl: "https://p6.music.126.net/ent.png",
                  },
                ],
              },
            },
            {
              blockCode: "wikiSubBlockSheetInfoVo",
              blockInfo: {
                totalNum: 2,
                wikiSubElementVos: [
                  {
                    id: 144807,
                    name: "钢琴、小提琴谱",
                    playVersion: "弹唱版",
                    totalPageSize: 6,
                    coverImageUrl: "https://p101.music.126.net/sheet.jpg",
                    type: [{ code: 100, name: "总谱", icon: "https://p6.music.126.net/staff.png" }],
                  },
                  {
                    id: 143985,
                    name: "吉他谱",
                    playVersion: "弹唱版",
                    totalPageSize: 4,
                    type: [{ code: 4, name: "吉他", icon: "https://p5.music.126.net/guitar.png" }],
                  },
                ],
              },
            },
          ],
        },
      },
      {
        positionCode: "songWikiSimSongs",
        rnData: {
          simSongs: [
            { id: 5257138, name: "屋顶", artists: [{ name: "周杰伦" }] },
            { id: 5257138, name: "屋顶", artists: [{ name: "周杰伦" }] },
            { id: 5268423, name: "手牵手", artists: [{ name: "王力宏" }] },
          ],
        },
      },
      {
        positionCode: "songWikiFirstListen",
        rnData: {
          firstListen: { season: "初冬", period: "深夜", time: "00:00", timestamp: 1543766426000 },
          totalPlay: { playCount: 711122, text: "喜欢的歌，就要听到天荒地老！" },
        },
      },
    ],
  };
  return { ...base, ...overrides, blocks: overrides?.blocks ?? base.blocks };
};

describe("歌曲百科归一化", () => {
  it("解析 construct/info 的区块结构", () => {
    const view = normalizeSongWiki(buildWiki(), null);

    expect(view.basicInfo).toEqual([
      { label: "曲风", tags: ["流行-华语流行"] },
      { label: "推荐标签", tags: ["治愈", "KTV"] },
      { label: "语种", tags: [], text: "国语" },
      { label: "BPM", tags: [], text: "69" },
    ]);
    expect(view.creationInfo).toEqual([
      { label: "作词", names: ["周杰伦"] },
      { label: "作曲", names: ["周杰伦"] },
    ]);
    expect(view.awards).toEqual([
      {
        title: "第2届hito流行音乐奖",
        subTitle: "Hito年度华语歌曲",
        image: "https://p6.music.126.net/award.png",
      },
    ]);
    expect(view.credentials).toEqual([
      {
        title: "综艺《乘风破浪》插曲",
        subTitle: "综艺 · 插曲",
        image: "https://p6.music.126.net/ent.png",
      },
    ]);
    expect(view.similarIds).toEqual(["5257138", "5268423"]);
    expect(view.sheets).toEqual([
      {
        id: "144807",
        name: "钢琴、小提琴谱",
        playVersion: "弹唱版",
        totalPageSize: 6,
        coverImageUrl: "https://p101.music.126.net/sheet.jpg",
        typeName: "总谱",
        typeIcon: "https://p6.music.126.net/staff.png",
      },
      {
        id: "143985",
        name: "吉他谱",
        playVersion: "弹唱版",
        totalPageSize: 4,
        coverImageUrl: undefined,
        typeName: "吉他",
        typeIcon: "https://p5.music.126.net/guitar.png",
      },
    ]);
  });

  it("读取音乐故事，构造块优先", () => {
    const view = normalizeSongWiki(buildWiki(), null);

    const story = view.story;
    expect(story?.firstListen?.season).toBe("初冬");
    expect(story?.firstListen?.period).toBe("深夜");
    expect(story?.firstListen?.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(story?.totalPlay).toEqual({ playCount: 711122, text: "喜欢的歌，就要听到天荒地老！" });
    expect(story?.likeSong).toBeUndefined();
  });

  it("个人聆听接口补充红心收藏并覆盖故事字段", () => {
    const listen: MusicListenData = {
      musicFirstListenDto: { season: "2024 年" },
      musicTotalPlayDto: { playCount: 999, text: "个人统计" },
      musicLikeSongDto: { like: true, text: "已收藏", redDesc: "2024 年红心" },
    };

    const view = normalizeSongWiki(buildWiki(), listen);

    expect(view.story?.firstListen?.season).toBe("2024 年");
    expect(view.story?.totalPlay?.playCount).toBe(999);
    expect(view.story?.likeSong).toEqual({ text: "已收藏", redDesc: "2024 年红心" });
  });

  it("个人聆听时间优先于构造块时间戳", () => {
    const listen: MusicListenData = {
      musicFirstListenDto: { listenTime: 1700000000000 },
    };

    const view = normalizeSongWiki(buildWiki(), listen);

    expect(view.story?.firstListen?.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(view.story?.firstListen?.date).toBe(formatDateTime(1700000000000));
  });

  it("个人聆听接口覆盖构造块的故事时段", () => {
    const listen: MusicListenData = {
      musicFirstListenDto: { season: "2024 年", period: "清晨" },
    };

    const view = normalizeSongWiki(buildWiki(), listen);

    expect(view.story?.firstListen?.season).toBe("2024 年");
    expect(view.story?.firstListen?.period).toBe("清晨");
  });

  it("未红心时不生成收藏卡片", () => {
    const listen: MusicListenData = {
      musicLikeSongDto: { like: false, text: "未收藏" },
    };
    const view = normalizeSongWiki(buildWiki(), listen);
    expect(view.story?.likeSong).toBeUndefined();
  });

  it("无故事块与个人数据时故事为 null", () => {
    const wiki: WikiData = { blocks: [] };
    const view = normalizeSongWiki(wiki, null);
    expect(view.story).toBeNull();
  });

  it("空数据不抛错", () => {
    const view = normalizeSongWiki(null, null);
    expect(view.story).toBeNull();
    expect(view.basicInfo).toEqual([]);
    expect(view.creationInfo).toEqual([]);
    expect(view.sheets).toEqual([]);
    expect(view.awards).toEqual([]);
    expect(view.credentials).toEqual([]);
    expect(view.similarIds).toEqual([]);
  });

  it("相似歌曲 ID 去重", () => {
    const wiki: WikiData = {
      blocks: [
        {
          positionCode: "songWikiSimSongs",
          rnData: {
            simSongs: [{ id: 5 }, { id: "5" }, { id: 6 }],
          },
        },
      ],
    };
    expect(normalizeSongWiki(wiki, null).similarIds).toEqual(["5", "6"]);
  });
});

describe("乐谱列表归一化", () => {
  it("读取完整乐谱列表并提取乐器类型图标", () => {
    const sheets = normalizeSheetList({
      musicSheetSimpleInfoVOS: [
        {
          id: 144807,
          name: "钢琴、小提琴谱",
          playVersion: "弹唱版",
          totalPageSize: 6,
          type: [{ code: 100, name: "总谱", icon: "https://p6.music.126.net/staff.png" }],
        },
        {
          id: "143985",
          name: "吉他谱",
          totalPageSize: 4,
          type: [{ code: 4, name: "吉他" }],
        },
      ],
    });
    expect(sheets).toEqual([
      {
        id: "144807",
        name: "钢琴、小提琴谱",
        playVersion: "弹唱版",
        totalPageSize: 6,
        coverImageUrl: undefined,
        typeName: "总谱",
        typeIcon: "https://p6.music.126.net/staff.png",
      },
      {
        id: "143985",
        name: "吉他谱",
        playVersion: undefined,
        totalPageSize: 4,
        coverImageUrl: undefined,
        typeName: "吉他",
        typeIcon: undefined,
      },
    ]);
  });

  it("缺少 id 的条目被丢弃，空数据返回空数组", () => {
    expect(normalizeSheetList({ musicSheetSimpleInfoVOS: [{ name: "无 id" }] })).toEqual([]);
    expect(normalizeSheetList(null)).toEqual([]);
  });
});
