<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { isExternalUrl, openExternal } from "@/utils/url";
import IconSettings2 from "~icons/lucide/settings-2";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconTrash2 from "~icons/lucide/trash-2";

const props = defineProps<{ info: PluginInfo; checking?: boolean }>();

const emit = defineEmits<{
  (event: "toggle", id: string, enabled: boolean): void;
  (event: "uninstall", id: string): void;
  (event: "configure", id: string): void;
  (event: "check", id: string): void;
  (event: "viewUpdate", id: string): void;
  (event: "detail", id: string): void;
}>();

const { t } = useI18n();

type TagType = "default" | "success" | "info" | "warning" | "error";

/** 当前状态 → 徽章颜色 + 文案 key */
const statusTag = computed<{ type: TagType; key: string }>(() => {
  const { enabled, status } = props.info;
  if (!enabled) return { type: "default", key: "disabled" };
  switch (status.state) {
    case "ready":
      return { type: "success", key: "ready" };
    case "loading":
      return { type: "info", key: "loading" };
    case "error":
      return { type: "error", key: "error" };
    case "disabled":
      return { type: "default", key: "disabled" };
    default:
      return { type: "warning", key: "unloaded" };
  }
});

const settings = computed(() =>
  props.info.status.state === "ready" ? (props.info.status.settings ?? []) : [],
);

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "check",
    label: t("settings.plugins.checkUpdate"),
    icon: markRaw(IconRefreshCw),
    show: !!props.info.manifest.updateUrl,
    disabled: props.checking,
  },
  {
    key: "uninstall",
    label: t("settings.plugins.uninstall"),
    icon: markRaw(IconTrash2),
    separator: !!props.info.manifest.updateUrl,
  },
]);

const onMenuSelect = (key: string): void => {
  const id = props.info.manifest.id;
  if (key === "check") emit("check", id);
  else if (key === "uninstall") emit("uninstall", id);
};
</script>

<template>
  <PluginCardBase
    :name="info.manifest.name"
    :description="info.manifest.description"
    :author="info.manifest.author"
    clickable
    @click="emit('detail', info.manifest.id)"
  >
    <!-- 待更新：紧贴名字 -->
    <template #name-suffix>
      <SButton
        v-if="info.updateInfo"
        class="shrink-0"
        size="tiny"
        variant="secondary"
        type="success"
        round
        @click.stop="emit('viewUpdate', info.manifest.id)"
      >
        <template #icon><IconLucideArrowUpCircle /></template>
        {{ t("settings.plugins.pendingUpdate") }}
      </SButton>
    </template>

    <!-- 外链 + 版本 + 状态 -->
    <template #title-end>
      <SButton
        v-if="isExternalUrl(info.manifest.homepage)"
        circle
        size="tiny"
        variant="text"
        :title="info.manifest.homepage"
        @click.stop="openExternal(info.manifest.homepage)"
      >
        <template #icon><IconLucideExternalLink /></template>
      </SButton>
      <STag size="small" round type="default" variant="soft">v{{ info.manifest.version }}</STag>
      <STag size="small" round :type="statusTag.type" variant="soft">
        {{ t(`settings.plugins.status.${statusTag.key}`) }}
      </STag>
    </template>

    <!-- 错误信息 -->
    <template v-if="info.status.state === 'error'" #extra>
      <div class="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-500 break-all line-clamp-2">
        {{ info.status.error.message }}
      </div>
    </template>

    <!-- 操作 -->
    <template #actions>
      <div class="flex items-center justify-between gap-2" @click.stop>
        <div class="flex items-center gap-1.5 min-w-0">
          <SButton
            variant="secondary"
            size="small"
            :type="info.enabled ? 'primary' : 'default'"
            @click="emit('toggle', info.manifest.id, info.enabled)"
          >
            <template #icon>
              <IconLucideCircleCheck v-if="info.enabled" class="size-4" />
              <IconLucidePower v-else class="size-4" />
            </template>
            {{ info.enabled ? t("common.enabled") : t("common.enable") }}
          </SButton>
          <SButton
            v-if="settings.length > 0"
            variant="secondary"
            size="small"
            @click="emit('configure', info.manifest.id)"
          >
            <template #icon><IconSettings2 class="size-4" /></template>
            {{ t("common.configure") }}
          </SButton>
        </div>
        <div class="shrink-0">
          <SDropdownMenu :items="menuItems" align="end" @select="onMenuSelect">
            <template #trigger>
              <SButton variant="secondary" size="small">
                <template #icon><IconLucideMoreHorizontal class="size-4" /></template>
                {{ t("common.more") }}
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
      </div>
    </template>
  </PluginCardBase>
</template>
