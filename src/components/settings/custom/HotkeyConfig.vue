<script setup lang="ts">
import type { HotkeyActionId } from "@shared/types/hotkey";
import { HOTKEY_ACTIONS } from "@shared/defaults/hotkeys";
import { useHotkeyStore } from "@/stores/hotkey";
import { useHotkeyRecorder } from "@/core/hotkey/recorder";
import { formatAccelerator } from "@shared/utils/accelerator";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import IconLucideRotateCcw from "~icons/lucide/rotate-ccw";
import { isMac } from "@/utils/config";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const hotkey = useHotkeyStore();

/** 快捷键作用域 */
type Scope = "inApp" | "global";

/** 录入目标 */
const recordingTarget = ref<{ id: HotkeyActionId; scope: Scope } | null>(null);

/** 错误信息 */
const errorFor = ref<{
  id: HotkeyActionId;
  scope: Scope;
  kind: "duplicate" | "osOccupied";
  conflictWith?: HotkeyActionId;
} | null>(null);

/** 清除错误信息 */
const clearError = (): void => {
  errorFor.value = null;
};

/** 获取动作标签 */
const labelOf = (id: HotkeyActionId): string => {
  const meta = HOTKEY_ACTIONS.find((a) => a.id === id);
  return meta ? t(meta.labelKey) : "";
};

/** 录入器 */
const recorder = useHotkeyRecorder({
  isMac: isMac,
  requireModifier: false,
  onConfirm: async (accel) => {
    const target = recordingTarget.value;
    if (!target) return;
    recordingTarget.value = null;
    /** 检查是否与应用内其他动作冲突 */
    if (target.scope === "inApp") {
      const dup = hotkey.findInAppDuplicate(accel, target.id);
      if (dup) {
        errorFor.value = { id: target.id, scope: "inApp", kind: "duplicate", conflictWith: dup };
        toast.error(t("settings.hotkeys.duplicateWith", { action: labelOf(dup) }));
        return;
      }
    } else {
      const ok = await hotkey.probe(accel);
      if (!ok) {
        errorFor.value = { id: target.id, scope: "global", kind: "osOccupied" };
        toast.error(t("settings.hotkeys.osOccupied"));
        return;
      }
    }
    /** 更新绑定 */
    const cur = hotkey.bindings[target.id] ?? { inApp: null, global: null };
    await hotkey.updateBinding(target.id, { ...cur, [target.scope]: accel });
  },
  onCancel: () => {
    recordingTarget.value = null;
  },
  onClear: async () => {
    const target = recordingTarget.value;
    recordingTarget.value = null;
    if (!target) return;
    clearError();
    const cur = hotkey.bindings[target.id] ?? { inApp: null, global: null };
    await hotkey.updateBinding(target.id, { ...cur, [target.scope]: null });
  },
});

/** 开始录入 */
const startRecord = (id: HotkeyActionId, scope: Scope): void => {
  if (scope === "global" && !hotkey.globalEnabled) return;
  clearError();
  if (
    recordingTarget.value &&
    recordingTarget.value.id === id &&
    recordingTarget.value.scope === scope
  ) {
    recorder.cancel();
    return;
  }
  if (recordingTarget.value) recorder.cancel();
  recordingTarget.value = { id, scope };
  recorder.start();
};

/** 停止录入 */
const stopRecord = (): void => {
  if (recorder.isRecording.value) recorder.cancel();
  clearError();
};

/** 重置单个动作 */
const resetSingle = async (id: HotkeyActionId): Promise<void> => {
  clearError();
  await hotkey.resetBinding(id);
};

/** 重置全部动作 */
const resetAll = async (): Promise<void> => {
  const ok = await dialog.confirm({
    title: t("settings.hotkeys.confirmResetTitle"),
    description: t("settings.hotkeys.confirmResetDesc"),
    type: "warning",
    confirmText: t("settings.hotkeys.resetRow"),
  });
  if (!ok) return;
  clearError();
  await hotkey.resetBinding();
};

/** 切换全局总开关 */
const toggleGlobalEnabled = async (v: boolean): Promise<void> => {
  await hotkey.setGlobalEnabled(v);
};

/** 获取值 */
const valueOf = (id: HotkeyActionId, scope: Scope): string => {
  const target = recordingTarget.value;
  if (target && target.id === id && target.scope === scope) {
    return recorder.current.value;
  }
  const accel = hotkey.bindings[id]?.[scope];
  if (!accel) return "";
  return formatAccelerator(accel, isMac);
};

/** 获取占位符 */
const placeholderOf = (id: HotkeyActionId, scope: Scope): string => {
  const target = recordingTarget.value;
  if (target && target.id === id && target.scope === scope) {
    return t("settings.hotkeys.recording");
  }
  return t("settings.hotkeys.unbound");
};

/** 检查全局是否被占用 */
const isGlobalOsOccupied = (id: HotkeyActionId): boolean =>
  hotkey.conflicts.some((c) => c.id === id && c.scope === "global" && c.reason === "os-occupied");

/** 检查状态 */
const statusOf = (id: HotkeyActionId, scope: Scope): "default" | "error" => {
  if (errorFor.value && errorFor.value.id === id && errorFor.value.scope === scope) return "error";
  if (scope === "global" && hotkey.globalEnabled && isGlobalOsOccupied(id)) return "error";
  return "default";
};

/** 获取错误标题 */
const errorTitleOf = (id: HotkeyActionId, scope: Scope): string => {
  const err = errorFor.value;
  if (err && err.id === id && err.scope === scope) {
    if (err.kind === "osOccupied") return t("settings.hotkeys.osOccupied");
    return t("settings.hotkeys.duplicateWith", { action: labelOf(err.conflictWith!) });
  }
  if (scope === "global" && hotkey.globalEnabled && isGlobalOsOccupied(id)) {
    return t("settings.hotkeys.osOccupied");
  }
  return "";
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t("settings.hotkeys.globalEnabled") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.hotkeys.globalEnabledHint") }}
        </div>
      </div>
      <SSwitch :model-value="hotkey.globalEnabled" @update:model-value="toggleGlobalEnabled" />
    </div>

    <!-- 第二块：绑定表 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 overflow-hidden"
    >
      <div
        class="px-4 py-2.5 flex items-center gap-3 text-sm text-on-surface-variant/60 border-b border-solid border-outline-variant/10"
      >
        <span class="flex-1">{{ t("settings.hotkeys.colAction") }}</span>
        <span class="w-48 text-center">{{ t("settings.hotkeys.colInApp") }}</span>
        <span class="w-48 text-center">{{ t("settings.hotkeys.colGlobal") }}</span>
        <span class="w-9" />
      </div>
      <div class="flex flex-col">
        <div
          v-for="action in HOTKEY_ACTIONS"
          :key="action.id"
          class="px-4 py-2.5 flex items-center gap-3 border-b border-solid border-outline-variant/10 last:border-b-0"
        >
          <span class="flex-1 text-sm">{{ t(action.labelKey) }}</span>

          <div class="w-48" :title="errorTitleOf(action.id, 'inApp')">
            <SInput
              readonly
              :model-value="valueOf(action.id, 'inApp')"
              :placeholder="placeholderOf(action.id, 'inApp')"
              :status="statusOf(action.id, 'inApp')"
              @focus="startRecord(action.id, 'inApp')"
              @blur="stopRecord"
            />
          </div>

          <div class="w-48" :title="errorTitleOf(action.id, 'global')">
            <SInput
              readonly
              :disabled="!hotkey.globalEnabled"
              :model-value="valueOf(action.id, 'global')"
              :placeholder="placeholderOf(action.id, 'global')"
              :status="statusOf(action.id, 'global')"
              @focus="startRecord(action.id, 'global')"
              @blur="stopRecord"
            />
          </div>

          <SButton
            variant="ghost"
            circle
            :title="t('settings.hotkeys.resetRow')"
            @click="resetSingle(action.id)"
          >
            <template #icon><IconLucideRotateCcw /></template>
          </SButton>
        </div>
      </div>
    </div>

    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t("settings.hotkeys.resetAll") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.hotkeys.resetAllHint") }}
        </div>
      </div>
      <SButton variant="secondary" @click="resetAll">
        {{ t("settings.hotkeys.resetRow") }}
      </SButton>
    </div>
  </div>
</template>
