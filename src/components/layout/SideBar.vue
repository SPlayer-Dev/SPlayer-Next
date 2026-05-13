<script setup lang="ts">
import type { SMenuItem } from "@/components/ui/SMenu.vue";
import { useSettingsStore } from "@/stores/settings";
import { usePlaylistStore } from "@/stores/playlist";
import IconLucideHome from "~icons/lucide/home";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideUser from "~icons/lucide/user";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideServer from "~icons/lucide/server";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucidePlus from "~icons/lucide/plus";
import SButton from "@/components/ui/SButton.vue";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { appearance, system: systemSettings } = useSettingsStore();
const playlistStore = usePlaylistStore();

const handleCreate = async () => {
  const playlist = await playlistStore.create(
    t("collection.create", { type: t("collection.playlist") }),
  );
  router.push(`/collection/local/playlist/${playlist.id}`);
};

const menuItems = computed<SMenuItem[]>(() => [
  // 本地音乐分组
  { key: "/", label: t("nav.home"), icon: markRaw(IconLucideHome) },
  { key: "/library", label: t("nav.library"), icon: markRaw(IconLucideMusic) },
  { key: "/artists/local", label: t("artist.label"), icon: markRaw(IconLucideUser) },
  { key: "/albums/local", label: t("album.label"), icon: markRaw(IconLucideDisc3) },
  { key: "/folders", label: t("folder.label"), icon: markRaw(IconLucideFolder) },
  // 流媒体（受 system.streaming.enabled 总开关控制）
  ...(systemSettings.streaming.enabled
    ? ([
        { key: "divider-streaming", type: "divider" },
        { key: "/streaming", label: t("nav.streaming"), icon: markRaw(IconLucideServer) },
      ] satisfies SMenuItem[])
    : []),
  // 歌单分组
  { key: "divider-playlist", type: "divider" },
  {
    key: "playlist-group",
    type: "group",
    render: () =>
      h("div", { class: "flex items-center justify-between px-3 py-2" }, [
        h(
          "span",
          { class: "text-sm text-on-surface-variant/70" },
          t("collection.my", { type: t("collection.playlist") }),
        ),
        h(
          SButton,
          { variant: "tertiary", size: "tiny", round: true, onClick: handleCreate },
          { icon: () => h(IconLucidePlus, { class: "size-3.5" }) },
        ),
      ]),
  },
  ...playlistStore.playlists.map((pl) => ({
    key: `/collection/local/playlist/${pl.id}`,
    label: pl.title,
    icon: markRaw(IconLucideListMusic),
  })),
]);

const activeKey = computed(() => {
  // 流媒体
  if (route.path.startsWith("/streaming")) return "/streaming";
  if (route.path.startsWith("/collection/streaming/")) return "/streaming";
  if (route.path.startsWith("/artist/streaming/")) return "/streaming";
  // 专辑详情页归属专辑列表
  if (route.path.startsWith("/collection/local/album/")) return "/albums/local";
  // 音乐库子页面
  if (route.path.startsWith("/collection/") && !route.path.includes("/playlist/"))
    return "/library";
  // 歌手详情页归属歌手列表
  if (route.path.startsWith("/artist/local/")) return "/artists/local";
  const items = menuItems.value.filter((item) => !item.type || item.type === "item");
  return (
    items.find((item) => route.path === item.key || route.path.startsWith(item.key + "/"))?.key ??
    "/"
  );
});

const onSelect = (key: string) => {
  router.push(key);
};

onMounted(() => {
  if (!playlistStore.initialized) playlistStore.load();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <SideBarLogo :collapsed="appearance.sidebarCollapsed" />
    <div
      class="flex-1 min-h-0 pb-3 overflow-y-auto transition-[padding] duration-300"
      :class="appearance.sidebarCollapsed ? 'px-2' : 'px-3'"
    >
      <SMenu
        :items="menuItems"
        :model-value="activeKey"
        :collapsed="appearance.sidebarCollapsed"
        @select="onSelect"
      />
    </div>
  </div>
</template>
