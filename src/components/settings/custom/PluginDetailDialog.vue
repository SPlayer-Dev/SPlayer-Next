<script setup lang="ts">
import type { Component } from "vue";
import type { PluginInfo, PluginGrant } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl, openExternal } from "@/utils/url";
import IconGlobe from "~icons/lucide/globe";
import IconGamepad from "~icons/lucide/gamepad-2";
import IconMenu from "~icons/lucide/menu";

const props = defineProps<{
  open: boolean;
  info: PluginInfo | null;
}>();
const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
}>();

const { t } = useI18n();
const pluginsStore = usePluginsStore();
const savingGrant = ref<PluginGrant | null>(null);

/**
 * 保存权限开关并反馈失败原因
 * @param grant - 权限名称
 * @param enabled - 是否允许该权限
 */
const setPermission = async (grant: PluginGrant, enabled: boolean): Promise<void> => {
  if (!props.info || savingGrant.value) return;
  savingGrant.value = grant;
  try {
    await pluginsStore.setPermission(props.info.manifest.id, grant, enabled);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingGrant.value = null;
  }
};

/** 权限图标 */
const GRANT_ICONS: Record<PluginGrant, Component> = {
  network: IconGlobe,
  control: IconGamepad,
  ui: IconMenu,
  library: IconMenu,
  api: IconGlobe,
};

/** ready 时的状态对象（含 sources/events/controls/settings/ui） */
const ready = computed(() => (props.info?.status.state === "ready" ? props.info.status : null));

const grantRows = computed(() =>
  (props.info?.manifest.grant ?? []).map((key) => ({ key, icon: GRANT_ICONS[key] })),
);

const sourceNames = computed(() => (ready.value ? Object.keys(ready.value.sources) : []));
const events = computed(() => ready.value?.events ?? []);
const hasControls = computed(() => !!ready.value?.controls);
const settingsCount = computed(() => ready.value?.settings?.length ?? 0);
const menusCount = computed(() => ready.value?.menus?.length ?? 0);

const fmtDate = (ms?: number): string =>
  typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—";

const setOpen = (value: boolean): void => emit("update:open", value);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('settings.plugins.detail.title')"
    width="540px"
    @update:open="setOpen"
  >
    <div v-if="info" class="flex flex-col gap-5">
      <!-- 头部 -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-on-surface">{{ info.manifest.name }}</span>
          <STag size="small" round type="default" variant="soft">v{{ info.manifest.version }}</STag>
          <SButton
            v-if="isExternalUrl(info.manifest.homepage)"
            class="ml-auto"
            circle
            size="tiny"
            variant="text"
            :title="info.manifest.homepage"
            @click="openExternal(info.manifest.homepage)"
          >
            <template #icon><IconLucideExternalLink /></template>
          </SButton>
        </div>
      </div>

      <!-- 简介 -->
      <section class="flex flex-col gap-1.5">
        <h4 class="text-xs font-medium text-on-surface-variant/60">
          {{ t("settings.plugins.detail.intro") }}
        </h4>
        <p
          class="m-0 text-sm leading-relaxed"
          :class="
            info.manifest.description ? 'text-on-surface-variant' : 'text-on-surface-variant/50'
          "
        >
          {{ info.manifest.description || t("settings.plugins.detail.noDescription") }}
        </p>
      </section>

      <!-- 权限 -->
      <section class="flex flex-col gap-1.5">
        <h4 class="text-xs font-medium text-on-surface-variant/60">
          {{ t("settings.plugins.detail.grants") }}
        </h4>
        <div class="flex flex-col gap-1.5">
          <div
            v-for="row in grantRows"
            :key="row.key"
            class="flex items-center gap-3 min-h-10 text-sm text-on-surface"
          >
            <component :is="row.icon" class="size-4 shrink-0" />
            <div class="flex-1 min-w-0">
              <label :for="`plugin-permission-${info.manifest.id}-${row.key}`" class="font-medium">
                {{ t(`settings.plugins.grant.${row.key}.label`) }}
              </label>
              <p class="m-0 text-xs leading-relaxed text-on-surface-variant/60">
                {{ t(`settings.plugins.grant.${row.key}.desc`) }}
              </p>
            </div>
            <SSwitch
              :id="`plugin-permission-${info.manifest.id}-${row.key}`"
              :aria-label="t(`settings.plugins.grant.${row.key}.label`)"
              :model-value="info.permissions?.[row.key] === true"
              :aria-disabled="savingGrant !== null"
              @update:model-value="setPermission(row.key, $event)"
            />
          </div>
          <p v-if="!grantRows.length" class="m-0 text-xs text-on-surface-variant/50">
            {{ t("settings.plugins.detail.grantNone") }}
          </p>
        </div>
      </section>

      <!-- 能力 -->
      <section v-if="ready" class="flex flex-col gap-1.5">
        <h4 class="text-xs font-medium text-on-surface-variant/60">
          {{ t("settings.plugins.detail.contributes") }}
        </h4>
        <div class="flex flex-col gap-1 text-sm text-on-surface-variant">
          <div v-if="sourceNames.length" class="flex items-center gap-2 flex-wrap">
            <span class="text-on-surface-variant/60">
              {{ t("settings.plugins.detail.sources") }}
            </span>
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
          </div>
          <div v-if="events.length" class="flex gap-2">
            <span class="text-on-surface-variant/60">
              {{ t("settings.plugins.detail.events") }}
            </span>
            <span>{{ events.join(", ") }}</span>
          </div>
          <div v-if="hasControls" class="flex gap-2">
            <span class="text-on-surface-variant/60">
              {{ t("settings.plugins.detail.controls") }}
            </span>
            <span>{{ t("settings.plugins.detail.controlsYes") }}</span>
          </div>
          <div v-if="settingsCount" class="flex gap-2">
            <span class="text-on-surface-variant/60">
              {{ t("settings.plugins.detail.settingsCount") }}
            </span>
            <span>{{ settingsCount }}</span>
          </div>
          <div v-if="menusCount" class="flex gap-2">
            <span class="text-on-surface-variant/60">
              {{ t("settings.plugins.detail.menus") }}
            </span>
            <span>{{ menusCount }}</span>
          </div>
        </div>
      </section>

      <!-- 信息 -->
      <section class="flex flex-col gap-1">
        <h4 class="text-xs font-medium text-on-surface-variant/60">
          {{ t("settings.plugins.detail.info") }}
        </h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-on-surface-variant">
          <div class="flex gap-2">
            <span class="text-on-surface-variant/50">{{ t("settings.plugins.detail.id") }}</span>
            <span class="font-mono break-all">{{ info.manifest.id }}</span>
          </div>
          <div class="flex gap-2 min-w-0">
            <span class="shrink-0 text-on-surface-variant/50">
              {{ t("settings.plugins.detail.author") }}
            </span>
            <span class="truncate">{{ info.manifest.author || "—" }}</span>
          </div>
          <div class="flex gap-2">
            <span class="text-on-surface-variant/50">
              {{ t("settings.plugins.detail.apiLevel") }}
            </span>
            <span>{{ info.manifest.apiLevel ?? "—" }}</span>
          </div>
          <div class="flex gap-2">
            <span class="text-on-surface-variant/50">
              {{ t("settings.plugins.detail.installed") }}
            </span>
            <span>{{ fmtDate(info.manifest.installedAt) }}</span>
          </div>
          <div class="flex gap-2">
            <span class="text-on-surface-variant/50">
              {{ t("settings.plugins.detail.updated") }}
            </span>
            <span>{{ fmtDate(info.manifest.updatedAt) }}</span>
          </div>
        </div>
      </section>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
