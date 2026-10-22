<script setup lang="ts">
import type { SMenuItem } from "@/components/ui/SMenu.vue";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { ContentScope } from "@/types/collection";
import { SIDEBAR_GROUP_MY_PLAYLISTS, SIDEBAR_GROUP_SUBSCRIBED } from "@/types/settings";
import { SIDEBAR_NAV_META, applySavedOrder } from "@/components/layout/sidebarNav";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { useDownloadStore } from "@/stores/download";
import { useHeartMode } from "@/composables/useHeartMode";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import * as player from "@/core/player";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import IconLucideEyeOff from "~icons/lucide/eye-off";
import IconLucideSettings2 from "~icons/lucide/settings-2";
import IconSpHeartMode from "~icons/sp/heart-mode";
import SButton from "@/components/ui/SButton.vue";
import SPopselect from "@/components/ui/SPopselect.vue";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { appearance, system: systemSettings } = useSettingsStore();
const status = useStatusStore();
const playlistStore = usePlaylistStore();
const userStore = useUserStore();
const downloadStore = useDownloadStore();
const { enterHeartMode } = useHeartMode();
const settingsDialog = useSettingsDialog();

/** 心动模式 */
const toggleHeartMode = useThrottleFn((): void => {
  if (status.heartMode) player.exitHeartMode();
  else void enterHeartMode();
}, 800);

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
const handleCreated = (playlistId: string, scope: ContentScope): void => {
  status.myPlaylistSource = scope;
  router.push(`/collection/${scope === "local" ? "local" : "netease"}/playlist/${playlistId}`);
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
        "onUpdate:modelValue": (value) => (status.myPlaylistSource = value as ContentScope),
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
      { variant: "tertiary", size: 26, round: true, onClick: handleCreate },
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

const hiddenKeys = computed(() => new Set(appearance.sidebarHiddenKeys));

/** 我的歌单 */
const myPlaylistItems = computed<SMenuItem[]>(() => {
  const showCover = appearance.sidebarPlaylistCover;
  const hidden = hiddenKeys.value;
  const local = status.myPlaylistSource === "local";
  const items: SMenuItem[] = local
    ? playlistStore.playlists.map((pl) => ({
        key: `/collection/local/playlist/${pl.id}`,
        label: pl.title,
        icon: markRaw(IconLucideListMusic),
        cover: pl.cover ?? "",
        showCover,
      }))
    : userStore.createdPlaylists.slice(1).map((pl) => ({
        key: `/collection/netease/playlist/${pl.id}`,
        label: pl.name,
        icon: markRaw(IconLucideListMusic),
        cover: pl.cover ?? "",
        showCover,
      }));
  const order = local
    ? appearance.sidebarPlaylistOrder.myLocal
    : appearance.sidebarPlaylistOrder.myOnline;
  return applySavedOrder(items, order).filter((item) => !hidden.has(item.key));
});

/** 收藏的歌单 */
const subscribedItems = computed<SMenuItem[]>(() => {
  const showCover = appearance.sidebarPlaylistCover;
  const hidden = hiddenKeys.value;
  const items: SMenuItem[] = userStore.subscribedPlaylists.map((pl) => ({
    key: `/collection/netease/playlist/${pl.id}`,
    label: pl.name,
    icon: markRaw(IconLucideListMusic),
    cover: pl.cover ?? "",
    showCover,
  }));
  return applySavedOrder(items, appearance.sidebarPlaylistOrder.subscribed).filter(
    (item) => !hidden.has(item.key),
  );
});

/** 「我喜欢」行尾的心动模式按钮 */
const renderHeartModeTrailing = () =>
  h(
    SButton,
    {
      type: status.heartMode ? "primary" : "default",
      variant: "tertiary",
      size: 26,
      iconSize: 16,
      round: true,
      onClick: toggleHeartMode,
    },
    { icon: () => h(IconSpHeartMode) },
  );

/** 下载任务角标 */
const renderDownloadTrailing = () =>
  h(
    "span",
    {
      class:
        "inline-flex items-center justify-center h-6 min-w-8.5 px-1.5 rounded-full bg-primary/16 text-primary text-xs font-medium tabular-nums leading-none cursor-pointer",
      onClick: () => router.push("/download"),
    },
    String(downloadStore.activeCount),
  );

/** 固定导航区：按分组生成，组间以分隔线或分组名标题区分 */
const navItems = computed<SMenuItem[]>(() => {
  const hidden = hiddenKeys.value;
  const segments: { title: string; items: SMenuItem[] }[] = [];
  for (const group of appearance.sidebarNavGroups) {
    const items: SMenuItem[] = [];
    for (const key of group.keys) {
      if (hidden.has(key)) continue;
      const entry = SIDEBAR_NAV_META[key];
      if (!entry) continue;
      if (key === "/download" && !systemSettings.download.enabled) continue;
      if (key === "/streaming" && !systemSettings.streaming.enabled) continue;
      const item: SMenuItem = { key, label: t(entry.labelKey), icon: markRaw(entry.icon) };
      if (key === "/liked") item.trailing = renderHeartModeTrailing;
      if (key === "/download" && downloadStore.activeCount > 0)
        item.trailing = renderDownloadTrailing;
      items.push(item);
    }
    if (items.length === 0 && !appearance.sidebarKeepEmptyDivider) continue;
    segments.push({ title: group.showName ? group.name.trim() : "", items });
  }
  const merged: SMenuItem[] = [];
  segments.forEach((segment, index) => {
    const hasTitle = segment.title.length > 0;
    if (index > 0 && segment.items.length > 0 && (!hasTitle || appearance.sidebarNameWithDivider))
      merged.push({ key: `divider-group-${index}`, type: "divider" });
    if (hasTitle) {
      merged.push({
        key: `group-title-${index}`,
        type: "group",
        render: () =>
          h("div", { class: "flex items-center px-3 min-h-10" }, [
            h("span", { class: "text-sm text-on-surface-variant/70" }, segment.title),
          ]),
      });
    }
    merged.push(...segment.items);
  });
  return merged;
});

const menuItems = computed<SMenuItem[]>(() => {
  const hidden = hiddenKeys.value;
  const items = [...navItems.value];
  const showMy = !hidden.has(SIDEBAR_GROUP_MY_PLAYLISTS);
  const showSubscribed =
    !hidden.has(SIDEBAR_GROUP_SUBSCRIBED) &&
    status.myPlaylistSource === "online" &&
    subscribedItems.value.length > 0;
  if ((showMy || showSubscribed) && items[items.length - 1]?.type !== "divider")
    items.push({ key: "divider-playlist", type: "divider" });
  if (showMy) {
    items.push({ key: "my-playlist-group", type: "group", render: renderMyHeader });
    items.push(...myPlaylistItems.value);
  }
  if (showSubscribed) {
    if (showMy) items.push({ key: "divider-subscribed", type: "divider" });
    items.push({ key: "subscribed-group", type: "group", render: renderSubscribedHeader });
    items.push(...subscribedItems.value);
  }
  return items;
});

/** 右键目标菜单项 key，在菜单弹出前由 contextmenu 捕获阶段记录 */
const contextTargetKey = ref("");

const onMenuContextMenu = (event: MouseEvent): void => {
  const el = (event.target as HTMLElement).closest("[data-menu-key]");
  contextTargetKey.value = el?.getAttribute("data-menu-key") ?? "";
};

const contextMenuItems = computed<DropdownMenuItem[]>(() => {
  const target = contextTargetKey.value;
  const entry = SIDEBAR_NAV_META[target];
  // 歌单项（/collection/ 前缀）与可隐藏导航项均支持右键隐藏
  const hideable = entry ? entry.hideable : target.startsWith("/collection/");
  return [
    {
      key: "hide",
      label: t("nav.menu.hideFromSidebar"),
      icon: markRaw(IconLucideEyeOff),
      show: hideable,
    },
    {
      key: "customize",
      label: t("nav.menu.customizeSidebar"),
      icon: markRaw(IconLucideSettings2),
    },
  ];
});

const onContextMenuSelect = (key: string): void => {
  if (key === "hide") {
    const target = contextTargetKey.value;
    if (target && !appearance.sidebarHiddenKeys.includes(target)) {
      appearance.sidebarHiddenKeys.push(target);
    }
    return;
  }
  if (key === "customize") settingsDialog.show("appearance", "sidebarCustomize");
};

const activeKey = computed(() => {
  // 媒体源
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

/**
 * 歌单存档收敛：删除歌单或在线列表刷新后，剔除不再存在的歌单键，
 * 防止隐藏/顺序存档随时间无限累积残留
 * @param existing - 当前存在的歌单路由键集合
 */
const prunePlaylistArchive = (existing: ReadonlySet<string>): void => {
  const isStale = (key: string): boolean => key.startsWith("/collection/") && !existing.has(key);
  const hiddenKeysNext = appearance.sidebarHiddenKeys.filter((key) => !isStale(key));
  if (hiddenKeysNext.length !== appearance.sidebarHiddenKeys.length)
    appearance.sidebarHiddenKeys = hiddenKeysNext;
  const order = appearance.sidebarPlaylistOrder;
  const prune = (list: string[]): string[] => list.filter((key) => !isStale(key));
  const myLocal = prune(order.myLocal);
  const myOnline = prune(order.myOnline);
  const subscribed = prune(order.subscribed);
  if (
    myLocal.length !== order.myLocal.length ||
    myOnline.length !== order.myOnline.length ||
    subscribed.length !== order.subscribed.length
  ) {
    appearance.sidebarPlaylistOrder = { myLocal, myOnline, subscribed };
  }
};

// 本地歌单加载完成后即可收敛
// 在线部分仅在已登录且列表非空时清理
watch(
  () => [playlistStore.playlists, userStore.isLoggedIn ? userStore.playlists : null] as const,
  ([localLists, onlineLists]) => {
    const existing = new Set<string>();
    for (const pl of localLists) existing.add(`/collection/local/playlist/${pl.id}`);
    if (onlineLists && onlineLists.length > 0) {
      for (const pl of onlineLists) existing.add(`/collection/netease/playlist/${pl.id}`);
    }
    if (existing.size === 0) return;
    prunePlaylistArchive(existing);
  },
  { deep: false },
);

onMounted(() => {
  if (!playlistStore.initialized) playlistStore.load();
  void downloadStore.init();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <SideBarLogo :collapsed="appearance.sidebarCollapsed" />
    <SContextMenu :items="contextMenuItems" @select="onContextMenuSelect">
      <div
        class="flex-1 min-h-0 pb-3 overflow-y-auto transition-[padding] duration-300"
        :class="
          appearance.sidebarCollapsed
            ? 'px-2 [&::-webkit-scrollbar]:hidden'
            : 'px-3 [scrollbar-gutter:stable]'
        "
        @contextmenu.capture="onMenuContextMenu"
      >
        <SMenu
          :items="menuItems"
          :model-value="activeKey"
          :collapsed="appearance.sidebarCollapsed"
          @select="onSelect"
        />
      </div>
    </SContextMenu>
    <!-- 新建歌单 -->
    <PlaylistCreateDialog
      v-model:open="createDialogOpen"
      :mode="createMode"
      @created="handleCreated"
    />
  </div>
</template>
