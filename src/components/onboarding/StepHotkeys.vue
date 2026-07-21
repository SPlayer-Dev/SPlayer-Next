<script setup lang="ts">
import { useHotkeyStore } from "@/stores/hotkey";
import { HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";
import { formatAccelerator } from "@shared/utils/accelerator";
import { isMac } from "@/utils/config";
import type { HotkeyActionId } from "@shared/types/hotkey";
import IconKeyboard from "~icons/lucide/keyboard";
import IconChevronLeft from "~icons/lucide/chevron-left";

const { t } = useI18n();
defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();

const hotkey = useHotkeyStore();
const { globalEnabled } = storeToRefs(hotkey);

/** 向导中展示的常用快捷键动作 */
const COMMON_ACTIONS: HotkeyActionId[] = [
  "player.togglePlay",
  "player.next",
  "player.prev",
  "player.volumeUp",
  "player.volumeDown",
  "player.toggleShuffle",
  "view.openSearch",
  "view.togglePlaylist",
];

/** 根据动作 id 获取默认绑定并格式化显示 */
const getDisplayBinding = (id: HotkeyActionId): { inApp: string; global: string } => {
  const meta = HOTKEY_ACTIONS.find((a) => a.id === id);
  if (!meta) return { inApp: "", global: "" };
  return {
    inApp: formatAccelerator(meta.defaultBinding.inApp, isMac),
    global: meta.allowGlobal ? formatAccelerator(meta.defaultBinding.global, isMac) : "",
  };
};
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconKeyboard class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.hotkeys.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.hotkeys.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <!-- 全局快捷键开关 -->
      <div
        class="flex items-center justify-between gap-4 rounded-xl bg-on-surface/4 border border-solid border-primary/10 px-4 py-3 mb-4"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">{{ t("settings.hotkeys.globalEnabled") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5 leading-relaxed">
            {{ t("settings.hotkeys.globalEnabledHint") }}
          </div>
        </div>
        <SSwitch v-model="globalEnabled" />
      </div>

      <!-- 常用快捷键列表 -->
      <div class="bg-on-surface/4 border border-solid border-primary/10 rounded-xl overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-solid border-outline-variant/15">
              <th
                class="text-left text-xs font-medium text-on-surface-variant/70 px-4 py-2.5 w-full min-w-32 whitespace-nowrap"
              >
                {{ t("settings.hotkeys.colAction") }}
              </th>
              <th
                class="text-center text-xs font-medium text-on-surface-variant/70 px-3 py-2.5 w-0 whitespace-nowrap"
              >
                {{ t("settings.hotkeys.colInApp") }}
              </th>
              <th
                class="text-center text-xs font-medium text-on-surface-variant/70 px-3 py-2.5 w-0 whitespace-nowrap"
              >
                {{ t("settings.hotkeys.colGlobal") }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(id, i) in COMMON_ACTIONS"
              :key="id"
              :class="
                i < COMMON_ACTIONS.length - 1
                  ? 'border-b border-solid border-outline-variant/10'
                  : ''
              "
            >
              <td class="px-4 py-2 text-on-surface whitespace-nowrap">
                {{ t(HOTKEY_ACTIONS.find((a) => a.id === id)!.labelKey) }}
              </td>
              <td class="px-3 py-2 text-center whitespace-nowrap">
                <kbd
                  v-if="getDisplayBinding(id).inApp"
                  class="inline-block px-1.5 py-0.5 rounded bg-surface-panel border border-solid border-outline-variant/20 text-xs font-mono whitespace-nowrap"
                >
                  {{ getDisplayBinding(id).inApp }}
                </kbd>
                <span v-else class="text-xs text-on-surface-variant/40">
                  {{ t("settings.hotkeys.unbound") }}
                </span>
              </td>
              <td class="px-3 py-2 text-center whitespace-nowrap">
                <kbd
                  v-if="getDisplayBinding(id).global"
                  class="inline-block px-1.5 py-0.5 rounded bg-surface-panel border border-solid border-outline-variant/20 text-xs font-mono whitespace-nowrap"
                >
                  {{ getDisplayBinding(id).global }}
                </kbd>
                <span v-else class="text-xs text-on-surface-variant/40">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="shrink-0 flex items-center gap-3 mt-4">
      <SButton variant="ghost" round :disabled="loading" @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round :loading="loading" @click="emit('next')">
        {{ t("onboarding.finish") }}
      </SButton>
    </div>
  </div>
</template>
