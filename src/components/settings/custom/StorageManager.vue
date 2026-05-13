<script setup lang="ts">
import localforage from "localforage";
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { usePlaylistStore } from "@/stores/playlist";
import { useSettingsStore } from "@/stores/settings";
import { APP_VERSION } from "@/utils/config";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

type ActionKey = "backup" | "restore" | "resetSettings" | "resetAll";

interface ActionRow {
  key: ActionKey;
  buttonKey: string;
  /** error 类型按钮（红色） */
  destructive?: boolean;
}

const rows: ActionRow[] = [
  { key: "backup", buttonKey: "backup.button" },
  { key: "restore", buttonKey: "restore.button" },
  { key: "resetSettings", buttonKey: "resetSettings.button" },
  { key: "resetAll", buttonKey: "resetAll.button", destructive: true },
];

const running = ref<ActionKey | null>(null);

/** 备份文件标识：恢复时用以辨识是否本应用导出的 JSON */
const BACKUP_TYPE = "splayer-settings";
/** 渲染端 settings store 持久化到 localStorage 的 key（与 pinia store id 同名） */
const SETTINGS_STORE_KEY = "settings";

interface BackupPayload {
  type: typeof BACKUP_TYPE;
  /** 导出时的软件版本号 */
  appVersion: string;
  exportedAt: number;
  /** 主进程 SystemConfig */
  main: unknown;
  /** 渲染端 settings store 持久化 state */
  renderer: { settings?: unknown };
}

/** 校验是否本应用导出的备份 */
const isBackupPayload = (data: unknown): data is BackupPayload => {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return obj.type === BACKUP_TYPE && "main" in obj;
};

/** 读取 localStorage 中已持久化的 settings state */
const readPersistedSettings = (): unknown => {
  const raw = localStorage.getItem(SETTINGS_STORE_KEY);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** 备份 */
const handleBackup = async (): Promise<void> => {
  const main = await window.api.config.getAll();
  const payload: BackupPayload = {
    type: BACKUP_TYPE,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    main,
    renderer: { settings: readPersistedSettings() },
  };
  const result = await window.api.config.exportToFile(payload);
  if (!result.ok) {
    if (result.reason === "writeFailed") toast.error(t("settings.backup.failed"));
    return;
  }
  toast.success(t("settings.backup.exported"));
};

/** 恢复 */
const handleRestore = async (): Promise<void> => {
  const picked = await window.api.config.importFromFile();
  if (!picked.ok) {
    if (picked.reason === "parseFailed") toast.error(t("settings.restore.invalid"));
    else if (picked.reason === "readFailed") toast.error(t("settings.restore.failed"));
    return;
  }
  if (!isBackupPayload(picked.data)) {
    toast.error(t("settings.restore.invalid"));
    return;
  }
  const confirmed = await dialog.confirm({
    title: t("settings.restore.confirmTitle"),
    content: t("settings.restore.confirmDesc"),
    type: "warning",
  });
  if (!confirmed) return;

  await window.api.config.replaceAll(picked.data.main);
  const settingsState = picked.data.renderer?.settings;
  if (settingsState !== undefined) {
    localStorage.setItem(SETTINGS_STORE_KEY, JSON.stringify(settingsState));
  }
  await window.api.system.relaunch();
};

/** 重置设置 */
const handleResetSettings = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.resetSettings.confirmTitle"),
    content: t("settings.resetSettings.confirmDesc"),
    type: "warning",
  });
  if (!confirmed) return;
  const settingsStore = useSettingsStore();
  settingsStore.$reset();
  await window.api.config.reset();
  toast.success(t("settings.resetSettings.done"));
};

/** 清除全部数据 */
const handleResetAll = async (): Promise<void> => {
  const confirmed = await dialog.confirm({
    title: t("settings.resetAll.confirmTitle"),
    content: t("settings.resetAll.confirmDesc"),
    type: "error",
  });
  if (!confirmed) return;
  const stores = ["playlists", "queue", "library"];
  await Promise.all(
    stores.map((name) => localforage.createInstance({ name: "splayer", storeName: name }).clear()),
  );
  const settingsStore = useSettingsStore();
  settingsStore.$reset();
  await window.api.config.reset();
  const playlistStore = usePlaylistStore();
  await playlistStore.load();
  toast.success(t("settings.resetAll.done"));
};

/** 按 key 分发并互斥执行 */
const runAction = async (key: ActionKey): Promise<void> => {
  if (running.value) return;
  running.value = key;
  try {
    if (key === "backup") await handleBackup();
    else if (key === "restore") await handleRestore();
    else if (key === "resetSettings") await handleResetSettings();
    else await handleResetAll();
  } finally {
    running.value = null;
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="row in rows"
      :key="row.key"
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base">{{ t(`settings.${row.key}.label`) }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t(`settings.${row.key}.description`) }}
        </div>
      </div>
      <SButton
        :type="row.destructive ? 'error' : 'primary'"
        variant="secondary"
        :loading="running === row.key"
        :disabled="running !== null && running !== row.key"
        @click="runAction(row.key)"
      >
        {{ t(`settings.${row.buttonKey}`) }}
      </SButton>
    </div>
  </div>
</template>
