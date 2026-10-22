import { mount } from "@vue/test-utils";
import { createPinia, defineStore } from "pinia";
import { createI18n } from "vue-i18n";
import { beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { Track } from "@shared/types/player";
const state = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/core/player", () => ({ playFrom: state.play }));
vi.mock("@/stores/streaming", () => ({
  useStreamingStore: defineStore("streaming-test", {
    state: () => ({ songs: [] as Track[], loading: false, isConnected: false }),
    actions: {
      /**
       * 读取测试歌曲的收藏状态
       * @param track - 测试歌曲
       * @returns 是否已收藏
       */
      isFavorite(track: Track) {
        return Boolean(track.favorite);
      },
      refreshLibrary: vi.fn(),
    },
  }),
}));
import { useStreamingStore } from "@/stores/streaming";
import Songs from "./Songs.vue";
beforeEach(() => vi.clearAllMocks());
it("收藏筛选随服务器状态更新，播放全部使用筛选后的歌曲", async () => {
  const pinia = createPinia();
  const store = useStreamingStore(pinia);
  const track: Track = { id: "a", source: "streaming", title: "歌曲", artists: [], duration: 1000 };
  store.songs = [
    { ...track, favorite: true },
    { ...track, id: "b", favorite: false },
  ];
  const wrapper = mount(Songs, {
    global: {
      plugins: [
        pinia,
        createI18n({
          legacy: false,
          locale: "zh-CN",
          messages: {
            "zh-CN": {
              streaming: { favoritesOnly: "仅看收藏", empty: { noFavorites: "暂无收藏" } },
              common: { playAll: "播放全部", search: "搜索" },
            },
          },
        }),
      ],
      stubs: {
        SButton: { template: "<button><slot /></button>" },
        SInput: true,
        SongList: {
          props: ["items", "searchQuery"],
          template: '<div data-list>{{ items.map(item => item.id).join(",") }}</div>',
        },
        IconLucidePlay: true,
        IconLucideHeart: true,
        IconLucideSearch: true,
        IconLucideMusic: true,
      },
    },
  });
  expect(wrapper.get("[data-list]").text()).toBe("a,b");
  await wrapper.get('[aria-pressed="false"]').trigger("click");
  expect(wrapper.get("[data-list]").text()).toBe("a");
  await wrapper.findAll("button")[0].trigger("click");
  expect(state.play).toHaveBeenCalledWith([store.songs[0]]);
  store.songs = store.songs.map((item) => ({ ...item, favorite: false }));
  await nextTick();
  expect(wrapper.text()).toContain("暂无收藏");
  expect(wrapper.findAll("button")[0].attributes()).toHaveProperty("disabled");
  wrapper.unmount();
});
