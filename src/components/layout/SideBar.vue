<script setup lang="ts">
import type { SMenuItem } from "@/components/ui/SMenu.vue";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { ContentScope } from "@/types/collection";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import IconLucideHome from "~icons/lucide/home";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideUser from "~icons/lucide/user";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideFolder from "~icons/lucide/folder";
import IconLucideServer from "~icons/lucide/server";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconMaterialSymbolsFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideStar from "~icons/lucide/star";
import IconLucideHistory from "~icons/lucide/history";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import SButton from "@/components/ui/SButton.vue";
import SPopselect from "@/components/ui/SPopselect.vue";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { appearance, system: systemSettings } = useSettingsStore();
const status = useStatusStore();
const playlistStore = usePlaylistStore();
const userStore = useUserStore();

const sourceOptions = computed<SSelectOption[]>(() => [
  { value: "local", label: t("collection.localPlaylist") },
  { value: "online", label: t("collection.onlinePlaylist") },
]);

const createDialogOpen = ref(false);
const createMode = ref<ContentScope>("local");

const handleCreate = (): void => {
  createMode.value = status.myPlaylistSource;
  createDialogOpen.value = true;
};

/** 新建成功后跳转到该歌单 */
const handleCreated = (playlistId: string): void => {
  router.push(
    `/collection/${createMode.value === "local" ? "local" : "netease"}/playlist/${playlistId}`,
  );
};

/** 我的歌单分组头部 */
const renderMyHeader = () =>
  h("div", { class: "flex items-center justify-between gap-2 pl-3 pr-1 min-h-10" }, [
    h(
      SPopselect,
      {
        modelValue: status.myPlaylistSource,
        options: sourceOptions.value,
        side: "bottom",
        align: "start",
        "onUpdate:modelValue": (v) => (status.myPlaylistSource = v as ContentScope),
      },
      {
        trigger: () =>
          h(
            "span",
            {
              class:
                "inline-flex items-center gap-1 text-sm text-on-surface-variant/70 hover:text-on-surface cursor-pointer leading-none transition-colors duration-200",
            },
            [
              t("collection.my", { type: t("collection.playlist") }),
              h(IconLucideChevronDown, { class: "size-3.5" }),
            ],
          ),
      },
    ),
    h(
      SButton,
      { variant: "tertiary", size: "tiny", round: true, onClick: handleCreate },
      { icon: () => h(IconLucidePlus, { class: "size-3.5" }) },
    ),
  ]);

/** 「收藏的歌单」分组头部 */
const renderSubscribedHeader = () =>
  h("div", { class: "flex items-center px-3 min-h-10" }, [
    h(
      "span",
      { class: "text-sm text-on-surface-variant/70" },
      t("collection.subscribed", { type: t("collection.playlist") }),
    ),
  ]);

/** 我的歌单 */
const myPlaylistItems = computed<SMenuItem[]>(() => {
  const showCover = appearance.sidebarPlaylistCover;
  if (status.myPlaylistSource === "local") {
    return playlistStore.playlists.map((pl) => ({
      key: `/collection/local/playlist/${pl.id}`,
      label: pl.title,
      icon: markRaw(IconLucideListMusic),
      cover: pl.cover ?? "",
      showCover,
    }));
  }
  // 在线模式
  return userStore.createdPlaylists.slice(1).map((pl) => ({
    key: `/collection/netease/playlist/${pl.id}`,
    label: pl.name,
    icon: markRaw(IconLucideListMusic),
    cover: pl.cover ?? "",
    showCover,
  }));
});

/** 收藏的歌单 */
const subscribedItems = computed<SMenuItem[]>(() => {
  const showCover = appearance.sidebarPlaylistCover;
  return userStore.subscribedPlaylists.map((pl) => ({
    key: `/collection/netease/playlist/${pl.id}`,
    label: pl.name,
    icon: markRaw(IconLucideListMusic),
    cover: pl.cover ?? "",
    showCover,
  }));
});

const menuItems = computed<SMenuItem[]>(() => [
  // 本地音乐分组
  { key: "/", label: t("nav.home"), icon: markRaw(IconLucideHome) },
  { key: "/library", label: t("nav.library"), icon: markRaw(IconLucideMusic) },
  { key: "/artists/local", label: t("artist.label"), icon: markRaw(IconLucideUser) },
  { key: "/albums/local", label: t("album.label"), icon: markRaw(IconLucideDisc3) },
  { key: "/folders", label: t("folder.label"), icon: markRaw(IconLucideFolder) },
  // 个人歌曲
  { key: "divider-personal", type: "divider" },
  { key: "/liked", label: t("nav.liked"), icon: markRaw(IconMaterialSymbolsFavoriteOutline) },
  ...(systemSettings.streaming.enabled
    ? ([
        { key: "/streaming", label: t("nav.streaming"), icon: markRaw(IconLucideServer) },
      ] satisfies SMenuItem[])
    : []),
  { key: "/favorites", label: t("nav.favorites"), icon: markRaw(IconLucideStar) },
  { key: "/history", label: t("nav.history"), icon: markRaw(IconLucideHistory) },
  // 我的歌单
  { key: "divider-playlist", type: "divider" },
  { key: "my-playlist-group", type: "group", render: renderMyHeader },
  ...myPlaylistItems.value,
  // 收藏的歌单
  ...(status.myPlaylistSource === "online" && subscribedItems.value.length > 0
    ? ([
        { key: "divider-subscribed", type: "divider" },
        { key: "subscribed-group", type: "group", render: renderSubscribedHeader },
        ...subscribedItems.value,
      ] satisfies SMenuItem[])
    : []),
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
      :class="
        appearance.sidebarCollapsed
          ? 'px-2 [&::-webkit-scrollbar]:hidden'
          : 'px-3 [scrollbar-gutter:stable]'
      "
    >
      <SMenu
        :items="menuItems"
        :model-value="activeKey"
        :collapsed="appearance.sidebarCollapsed"
        @select="onSelect"
      />
    </div>
    <!-- 新建歌单 -->
    <PlaylistCreateDialog
      v-model:open="createDialogOpen"
      :mode="createMode"
      @created="handleCreated"
    />
  </div>
</template>
