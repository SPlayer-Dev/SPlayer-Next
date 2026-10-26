import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { Track } from "@shared/types/player";
import zhCN from "@/i18n/locales/zh-CN.json";

const state = vi.hoisted(() => ({
  playFrom: vi.fn(),
  scrollToIndex: vi.fn(),
  media: { track: null as Track | null },
}));
vi.mock("@/core/player", () => ({ playFrom: state.playFrom }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => state.media }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ isPlaying: false }) }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    appearance: { songListStyle: "compact" },
    player: { songListPlayBehavior: "all" },
    preset: {},
    system: { download: { enabled: false } },
  }),
}));
vi.mock("@/stores/download", () => ({ useDownloadStore: () => ({ isDownloaded: () => false }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: () => ({}) }));
vi.mock("@/stores/playlist", () => ({ usePlaylistStore: () => ({}) }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({}) }));
vi.mock("@/composables/useTrackMenu", () => ({
  useTrackMenu: () => ({ items: [], handleSelect: vi.fn() }),
}));
vi.mock("@/composables/useDownload", () => ({
  useDownload: () => ({ enqueue: vi.fn(), enqueueMany: vi.fn() }),
}));
vi.mock("@/composables/useFavorite", () => ({
  useFavorite: () => ({ isSupported: () => false, isLiked: () => false }),
}));
vi.mock("@/composables/useFloatingPlayerBar", () => ({
  useFloatingPlayerBar: () => ({ isFloatingBar: ref(false), PLAYER_BAR_GAP: 112 }),
}));
vi.mock("@/composables/usePlaylistPicker", () => ({
  usePlaylistPicker: () => ({
    open: ref(false),
    tracks: ref([]),
    mode: ref("add"),
    openPicker: vi.fn(),
  }),
}));
vi.mock("@/utils/navigate", () => ({ navigateToAlbum: vi.fn(), navigateToArtist: vi.fn() }));
import SongList from "./SongList.vue";

const tracks: Track[] = [
  {
    id: "a",
    source: "netease",
    title: "少年与海",
    artists: [],
    duration: 1000,
    disc: "1 致天堂的信",
    track: 1,
  },
  {
    id: "b",
    source: "netease",
    title: "受难曲",
    artists: [],
    duration: 1000,
    disc: "1 致天堂的信",
    track: 7,
  },
  {
    id: "c",
    source: "netease",
    title: "GLORIA",
    artists: [],
    duration: 1000,
    disc: "2 天堂的回信",
    track: 8,
  },
  {
    id: "d",
    source: "netease",
    title: "老人与海",
    artists: [],
    duration: 1000,
    disc: "2 天堂的回信",
    track: 9,
  },
];

/**
 * 挂载歌曲列表，替换滚动布局和外部服务，保留分组、排序、播放及多选逻辑
 * @param props - 当前场景的列表参数
 * @returns 可交互的列表包装器
 */
const mountList = (props: Partial<InstanceType<typeof SongList>["$props"]> = {}) =>
  mount(SongList, {
    props: {
      items: tracks,
      collectionType: "album",
      source: "netease",
      enableSort: true,
      ...props,
    },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } }),
        createRouter({
          history: createMemoryHistory(),
          routes: [{ path: "/", component: { template: "<div />" } }],
        }),
      ],
      stubs: {
        SContextMenu: { template: "<div><slot /></div>" },
        SVirtualList: {
          props: ["items"],
          setup: (_, { expose }) => {
            expose({ scrollToIndex: state.scrollToIndex });
          },
          template:
            '<div><slot name="header" /><div v-for="(item, index) in items" :key="item.key"><slot :item="item" :index="index" /></div></div>',
        },
        SButton: { template: '<button><slot name="icon" /><slot /></button>' },
        SCheckbox: {
          props: ["checked"],
          template:
            '<input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', !checked)" />',
        },
        SPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
        SRadioGroup: {
          props: ["value"],
          template:
            '<select :value="value" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
        },
        SRadio: {
          props: ["value", "label"],
          template: '<option :value="value">{{ label }}</option>',
        },
        SDialog: true,
        PlaylistPickerDialog: true,
        TagEditorDialog: true,
        SImg: true,
        STag: true,
        SIconSwap: true,
        SDivider: true,
        SLoading: true,
        ...Object.fromEntries(
          [
            "Disc3",
            "Music",
            "Pause",
            "Play",
            "Cloud",
            "Check",
            "ListEnd",
            "ListPlus",
            "ListMinus",
            "Download",
            "CloudOff",
            "Trash2",
            "X",
            "ArrowLeftRight",
            "ArrowUpDown",
            "ArrowUpAz",
            "ArrowUp",
            "Locate",
            "SearchX",
          ].map((name) => ["IconLucide" + name, true]),
        ),
        IconMaterialSymbolsFavoriteRounded: true,
        IconMaterialSymbolsFavoriteOutlineRounded: true,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.media.track = null;
});

describe("专辑分碟列表", () => {
  it("展示完整碟名和数量，第二碟双击与播放按钮仍使用歌曲索引", async () => {
    const wrapper = mountList();
    expect(wrapper.findAll("[data-disc-header]").map((header) => header.text())).toEqual([
      "Disc 1 致天堂的信共 2 首",
      "Disc 2 天堂的回信共 2 首",
    ]);
    const row = wrapper.findAll("[data-song-item]")[2];
    await row.trigger("dblclick");
    expect(state.playFrom).toHaveBeenLastCalledWith(tracks, { startIndex: 2, context: undefined });
    await row.get(".w-8").trigger("click");
    expect(state.playFrom).toHaveBeenLastCalledWith(tracks, { startIndex: 2, context: undefined });
    expect(row.get(".w-8").text()).toContain("8");
    wrapper.unmount();
  });

  it("搜索只保留有结果的碟片，播放使用过滤后的队列", async () => {
    const wrapper = mountList({ searchQuery: "GLORIA" });
    expect(wrapper.findAll("[data-disc-header]")).toHaveLength(1);
    expect(wrapper.get("[data-disc-header]").text()).toContain("2 天堂的回信");
    await wrapper.get("[data-song-item]").trigger("dblclick");
    expect(state.playFrom).toHaveBeenLastCalledWith([tracks[2]], {
      startIndex: 0,
      context: undefined,
    });
    await wrapper.setProps({ searchQuery: "不存在" });
    expect(wrapper.findAll("[data-disc-header]")).toHaveLength(0);
    wrapper.unmount();
  });

  it("单碟专辑和歌单保持普通列表，自定义排序取消分碟", async () => {
    const wrapper = mountList({ items: tracks.slice(0, 2) });
    expect(wrapper.findAll("[data-disc-header]")).toHaveLength(0);
    await wrapper.setProps({ items: tracks, collectionType: "playlist" });
    expect(wrapper.findAll("[data-disc-header]")).toHaveLength(0);
    await wrapper.setProps({
      collectionType: "album",
      items: tracks.map((track, index) => ({
        ...track,
        title: ["Zebra", "Bravo", "Alpha", "Delta"][index],
      })),
    });
    await wrapper.findAll("select")[0].setValue("title");
    expect(wrapper.findAll("[data-disc-header]")).toHaveLength(0);
    await wrapper.findAll("[data-song-item]")[0].trigger("dblclick");
    expect(state.playFrom.mock.lastCall?.[0][0].id).toBe("c");
    wrapper.unmount();
  });

  it("定位当前歌曲包含标题偏移，批量全选不包含碟片标题", async () => {
    state.media.track = tracks[2];
    const wrapper = mountList();
    await wrapper.get("icon-lucide-locate-stub").element.parentElement?.click();
    expect(state.scrollToIndex).toHaveBeenCalledWith(4);
    wrapper.vm.enterBatch();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true);
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(5);
    expect(
      wrapper
        .findAll('input[type="checkbox"]')
        .every((input) => (input.element as HTMLInputElement).checked),
    ).toBe(true);
    wrapper.unmount();
  });
});
