<script setup lang="ts">
import type { PluginInfo } from "@shared/types/plugin";
import { isExternalUrl, openExternal } from "@/utils/url";

const props = defineProps<{ info: PluginInfo }>();

const emit = defineEmits<{
  (event: "toggle", id: string, enabled: boolean): void;
  (event: "uninstall", id: string): void;
  (event: "configure", id: string): void;
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

/** ready 时声明的 sources 名（音源类才有） */
const sourceNames = computed<string[]>(() =>
  props.info.status.state === "ready" ? Object.keys(props.info.status.sources) : [],
);

/** ready 时控制类声明的设置 schema（决定是否显示「配置」按钮） */
const settings = computed(() =>
  props.info.status.state === "ready" ? (props.info.status.settings ?? []) : [],
);
</script>

<template>
  <div
    class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
  >
    <div class="flex items-start gap-3">
      <!-- 主体信息 -->
      <div class="flex-1 min-w-0">
        <!-- 标题行：名字 + 外链 + 版本 + 状态 -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-on-surface truncate">{{ info.manifest.name }}</span>
          <button
            v-if="isExternalUrl(info.manifest.homepage)"
            type="button"
            class="p-0 border-none bg-transparent text-on-surface-variant/50 hover:text-primary cursor-pointer transition-colors leading-0"
            :title="info.manifest.homepage"
            @click="openExternal(info.manifest.homepage)"
          >
            <IconLucideExternalLink class="size-3.5" />
          </button>
          <STag size="tiny" type="default" variant="soft">v{{ info.manifest.version }}</STag>
          <STag size="tiny" :type="statusTag.type" variant="soft">
            {{ t(`settings.plugins.status.${statusTag.key}`) }}
          </STag>
          <STag v-if="info.updateInfo" size="tiny" type="warning" variant="soft">
            {{ t("settings.plugins.updateAvailable") }}
          </STag>
        </div>

        <!-- 简介 -->
        <div
          v-if="info.manifest.description"
          class="mt-1.5 flex items-start gap-1.5 text-xs text-on-surface-variant/70"
        >
          <IconLucideInfo class="size-3.5 shrink-0 mt-0.5 opacity-60" />
          <span class="line-clamp-2">{{ info.manifest.description }}</span>
        </div>

        <!-- 作者 + 支持源 -->
        <div
          v-if="info.manifest.author || sourceNames.length"
          class="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-on-surface-variant/60"
        >
          <span v-if="info.manifest.author" class="flex items-center gap-1">
            <IconLucideUser class="size-3.5 opacity-60" />
            {{ info.manifest.author }}
          </span>
          <span v-if="sourceNames.length" class="flex items-center gap-1 flex-wrap">
            <STag
              v-for="src in sourceNames"
              :key="src"
              size="tiny"
              variant="soft"
              type="primary"
              class="gap-1"
            >
              <IconLucideDatabase class="size-3" />
              {{ src }}
            </STag>
          </span>
        </div>

        <!-- 错误信息 -->
        <div
          v-if="info.status.state === 'error'"
          class="mt-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-500 break-all"
        >
          {{ info.status.error.message }}
        </div>

        <!-- 更新提示 -->
        <div
          v-if="info.updateInfo"
          class="mt-2 rounded-md bg-amber-500/10 px-3 py-2 flex flex-col gap-1.5"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <IconLucideArrowUpCircle class="size-3.5" />
              <span>
                {{ t("settings.plugins.newVersion") }}
                <template v-if="info.updateInfo.version">v{{ info.updateInfo.version }}</template>
              </span>
            </div>
            <SButton
              v-if="isExternalUrl(info.updateInfo.updateUrl)"
              variant="secondary"
              size="tiny"
              type="warning"
              @click="openExternal(info.updateInfo.updateUrl)"
            >
              <template #icon>
                <IconLucideExternalLink class="size-3" />
              </template>
              {{ t("settings.plugins.openUpdateUrl") }}
            </SButton>
          </div>
          <div
            v-if="info.updateInfo.log"
            class="text-xs text-on-surface-variant/80 whitespace-pre-wrap break-words"
          >
            {{ info.updateInfo.log }}
          </div>
        </div>
      </div>

      <!-- 操作区：配置（控制类有 schema 才显示）+ 启用 + 卸载 -->
      <div class="shrink-0 flex items-center gap-2">
        <SButton
          v-if="settings.length > 0"
          variant="secondary"
          size="small"
          @click="emit('configure', info.manifest.id)"
        >
          <template #icon>
            <IconLucideSettings2 class="size-4" />
          </template>
          {{ t("common.configure") }}
        </SButton>
        <SButton
          :variant="info.enabled ? 'filled' : 'secondary'"
          size="small"
          :type="info.enabled ? 'primary' : 'default'"
          @click="emit('toggle', info.manifest.id, info.enabled)"
        >
          <template #icon>
            <IconLucideCircleCheck v-if="info.enabled" class="size-4" />
            <IconLucidePower v-else class="size-4" />
          </template>
          {{ info.enabled ? t("settings.plugins.enabled") : t("settings.plugins.enable") }}
        </SButton>
        <SButton
          variant="secondary"
          size="small"
          type="error"
          @click="emit('uninstall', info.manifest.id)"
        >
          <template #icon>
            <IconLucideTrash2 class="size-4" />
          </template>
          {{ t("settings.plugins.uninstall") }}
        </SButton>
      </div>
    </div>
  </div>
</template>
