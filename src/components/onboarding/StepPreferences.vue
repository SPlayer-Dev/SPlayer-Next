<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { LOCALES } from "@shared/types/settings";
import type { ThemeMode } from "@/types/theme";
import { DEFAULT_PRIMARY } from "@/utils/color";
import appearanceCategory from "@/settings/categories/appearance";
import { pickItems } from "@/settings/pickItems";
import IconSettings from "~icons/lucide/settings-2";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconMonitor from "~icons/lucide/monitor";
import IconCheck from "~icons/lucide/check";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();
const settings = useSettingsStore();
const theme = useThemeStore();
const { mode, source, customColor } = storeToRefs(theme);

const MODES: { value: ThemeMode; icon: typeof IconSun; labelKey: string }[] = [
  { value: "light", icon: IconSun, labelKey: "settings.themeMode.light" },
  { value: "dark", icon: IconMoon, labelKey: "settings.themeMode.dark" },
  { value: "system", icon: IconMonitor, labelKey: "settings.themeMode.system" },
];

const PRESET_COLORS = [
  DEFAULT_PRIMARY,
  "#FF6B6B",
  "#FFA94D",
  "#FFD43B",
  "#51CF66",
  "#22B8CF",
  "#5C7CFA",
  "#CC5DE8",
];

const isColorActive = (hex: string): boolean =>
  source.value === "custom" && customColor.value.toLowerCase() === hex.toLowerCase();

/** 外观风格（含自定义背景图子项） */
const appearanceItems = pickItems(appearanceCategory, ["appearanceStyle"]);
/** 字体配置 */
const fontItems = pickItems(appearanceCategory, ["fontConfig"]);
/** 布局相关设置 */
const layoutItems = pickItems(appearanceCategory, [
  "layoutMode",
  "routeTransition",
  "sidebarCollapsed",
  "sidebarPlaylistCover",
  "showQualitySwitch",
]);
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconSettings class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.preferences.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.preferences.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <div class="flex flex-col mb-6">
        <!-- 语言 -->
        <h3 class="text-sm font-medium text-on-surface-variant/80 mb-2 px-1">
          {{ t("settings.section.language") }}
        </h3>
        <div
          class="flex items-center justify-between gap-4 rounded-xl bg-on-surface/4 border border-solid border-primary/10 px-4 py-3"
        >
          <span class="text-sm">{{ t("onboarding.preferences.languageLabel") }}</span>
          <div class="shrink-0 w-40 flex justify-end">
            <SSelect
              :model-value="settings.locale"
              :options="LOCALES"
              @update:model-value="settings.locale = $event as typeof settings.locale"
            />
          </div>
        </div>

        <!-- 主题 -->
        <h3 class="text-sm font-medium text-on-surface-variant/80 mt-5 mb-2 px-1">
          {{ t("settings.section.theme") }}
        </h3>
        <div class="flex flex-col gap-2">
          <div
            class="flex items-center justify-between gap-4 rounded-xl bg-on-surface/4 border border-solid border-primary/10 px-4 py-3"
          >
            <span class="text-sm">{{ t("onboarding.preferences.modeLabel") }}</span>
            <div class="shrink-0 flex items-center gap-1.5">
              <SButton
                v-for="m in MODES"
                :key="m.value"
                :type="mode === m.value ? 'primary' : 'default'"
                :variant="mode === m.value ? 'secondary' : 'tertiary'"
                size="small"
                round
                :icon-size="14"
                @click="mode = m.value"
              >
                <template #icon><component :is="m.icon" /></template>
                {{ t(m.labelKey) }}
              </SButton>
            </div>
          </div>

          <div
            class="flex items-center justify-between gap-4 rounded-xl bg-on-surface/4 border border-solid border-primary/10 px-4 py-3"
          >
            <span class="text-sm shrink-0">{{ t("onboarding.preferences.colorLabel") }}</span>
            <div class="shrink-0 flex flex-wrap items-center gap-1.5 justify-end">
              <SButton
                v-for="hex in PRESET_COLORS"
                :key="hex"
                variant="text"
                circle
                :size="24"
                :style="{ background: hex }"
                :class="
                  isColorActive(hex) ? 'ring-2 ring-on-surface ring-offset-2 ring-offset-app' : ''
                "
                :icon-size="12"
                @click="theme.setCustomColor(hex)"
              >
                <template v-if="isColorActive(hex)" #icon>
                  <IconCheck class="text-white drop-shadow" />
                </template>
              </SButton>
              <SButton
                :type="source === 'cover' ? 'primary' : 'default'"
                :variant="source === 'cover' ? 'secondary' : 'tertiary'"
                size="small"
                round
                @click="theme.setSource('cover')"
              >
                {{ t("settings.themeSource.cover") }}
              </SButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 外观风格 -->
      <h3 class="text-sm font-medium text-on-surface-variant/80 mt-5 mb-2 px-1">
        {{ t("settings.section.appearanceStyle") }}
      </h3>
      <div class="flex flex-col gap-2.5 mb-6">
        <SettingsItem v-for="item in appearanceItems" :key="item.key" :item="item" />
      </div>

      <!-- 字体 -->
      <h3 class="text-sm font-medium text-on-surface-variant/80 mt-5 mb-2 px-1">
        {{ t("settings.section.font") }}
      </h3>
      <div class="flex flex-col gap-2.5 mb-6">
        <SettingsItem v-for="item in fontItems" :key="item.key" :item="item" />
      </div>

      <!-- 布局 -->
      <h3 class="text-sm font-medium text-on-surface-variant/80 mt-5 mb-2 px-1">
        {{ t("settings.section.layout") }}
      </h3>
      <div class="flex flex-col gap-2.5">
        <SettingsItem v-for="item in layoutItems" :key="item.key" :item="item" />
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 mt-4">
      <SButton variant="ghost" round @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="emit('next')">
        {{ t("onboarding.next") }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>
  </div>
</template>
