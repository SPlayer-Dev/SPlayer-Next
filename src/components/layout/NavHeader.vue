<script setup lang="ts">
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { useThemeStore } from "@/stores/theme";
import { useUpdateStore } from "@/stores/update";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import IconSun from "~icons/lucide/sun";
import IconMoon from "~icons/lucide/moon";
import IconMonitor from "~icons/lucide/monitor";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconTerminal from "~icons/lucide/terminal";
import IconSettings from "~icons/lucide/settings";
import IconScaling from "~icons/lucide/scaling";

const router = useRouter();
const { t } = useI18n();
const { show: showSettings } = useSettingsDialog();
const theme = useThemeStore();
const update = useUpdateStore();

/** 界面缩放弹窗开关 */
const uiZoomOpen = ref(false);

const themeIcon = computed(() => {
  if (theme.mode === "light") return IconMoon;
  if (theme.mode === "dark") return IconMonitor;
  return IconSun;
});

const themeLabel = computed(() => {
  if (theme.mode === "light") return t("settings.themeMode.dark");
  if (theme.mode === "dark") return t("settings.themeMode.system");
  return t("settings.themeMode.light");
});

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "theme",
    label: themeLabel.value,
    icon: themeIcon.value,
    disabled: theme.appearanceStyle === "image",
  },
  { key: "uiZoom", label: t("uiZoom.title"), icon: IconScaling },
  { key: "reload", label: t("nav.reload"), icon: IconRefreshCw, separator: true },
  { key: "devtools", label: t("nav.devtools"), icon: IconTerminal },
  { key: "settings", label: t("nav.globalSettings"), icon: IconSettings },
]);

const onMenuSelect = (key: string): void => {
  if (key === "theme") theme.cycleMode();
  else if (key === "reload") location.reload();
  else if (key === "devtools") window.api.system.toggleDevTools();
  else if (key === "uiZoom") uiZoomOpen.value = true;
  else if (key === "settings") showSettings();
};
</script>

<template>
  <div class="flex items-center flex-1 h-full app-drag-region">
    <!-- 左侧 -->
    <div class="flex items-center gap-3 shrink-0">
      <SButton
        class="app-no-drag"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.back()"
      >
        <template #icon><IconLucideChevronLeft /></template>
      </SButton>
      <SButton
        class="app-no-drag"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        @click="router.forward()"
      >
        <template #icon><IconLucideChevronRight /></template>
      </SButton>
      <NavSearch />
      <SButton
        v-if="update.hasUpdate"
        class="app-no-drag"
        variant="tertiary"
        circle
        :size="40"
        :icon-size="20"
        :title="t('update.dialogTitle')"
        @click="update.openDialog()"
      >
        <template #icon><IconLucideCircleArrowUp /></template>
      </SButton>
    </div>
    <!-- 中间 -->
    <div class="flex-1 h-full" />
    <!-- 右侧 -->
    <div class="flex items-center gap-3 shrink-0">
      <NavUser />
      <SDropdownMenu :items="menuItems" @select="onMenuSelect">
        <template #trigger>
          <SButton class="app-no-drag" variant="tertiary" circle :size="40">
            <template #icon><IconLucideSettings /></template>
          </SButton>
        </template>
      </SDropdownMenu>
      <SDivider vertical />
      <WindowControls />
    </div>
    <UiZoomDialog v-model:open="uiZoomOpen" />
  </div>
</template>
