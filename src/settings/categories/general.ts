import type { SettingCategory } from "@/types/settings-schema";
import { LOCALES } from "@shared/types/settings";
import StorageManager from "@/components/settings/custom/StorageManager.vue";
import { useUpdateStore } from "@/stores/update";
import IconLucideCog from "~icons/lucide/cog";

const generalCategory: SettingCategory = {
  id: "general",
  icon: IconLucideCog,
  sections: [
    {
      id: "language",
      items: [
        {
          key: "language",
          type: "select",
          binding: { store: "settings", path: "locale" },
          options: LOCALES.map(({ value, label }) => ({ value, label })),
          defaultValue: "zh-CN",
        },
      ],
    },
    {
      id: "systemConfig",
      items: [
        {
          key: "rememberWindowState",
          type: "switch",
          binding: { store: "settings", path: "system.system.rememberWindowState" },
          defaultValue: true,
        },
        {
          key: "borderlessWindow",
          type: "switch",
          binding: { store: "settings", path: "system.system.borderlessWindow" },
          defaultValue: true,
          confirm: {
            titleKey: "settings.confirm.restartRequiredTitle",
            contentKey: "settings.confirm.restartRequiredContent",
            type: "warning",
            confirmTextKey: "common.saveAndRelaunch",
          },
          action: async (next) => {
            await window.api.config.set("system.borderlessWindow", next);
            await window.api.system.relaunch();
          },
        },
        {
          key: "taskbarProgress",
          type: "switch",
          binding: { store: "settings", path: "system.system.taskbarProgress" },
          defaultValue: true,
        },
        {
          key: "taskbarThumbnailCover",
          type: "switch",
          binding: { store: "settings", path: "system.system.taskbarThumbnailCover" },
          defaultValue: true,
          visible: () => navigator.platform.startsWith("Win"),
        },
        {
          key: "orpheusProtocol",
          type: "switch",
          binding: { store: "settings", path: "system.system.registerOrpheusProtocol" },
          defaultValue: false,
        },
        {
          key: "closeAction",
          type: "select",
          binding: { store: "settings", path: "appearance.closeAction" },
          options: [
            { value: "quit", labelKey: "settings.closeAction.quit" },
            { value: "hide", labelKey: "settings.closeAction.hide" },
          ],
          defaultValue: "hide",
        },
        {
          key: "rememberCloseChoice",
          type: "switch",
          binding: { store: "settings", path: "appearance.rememberCloseChoice" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "update",
      items: [
        {
          key: "autoCheckUpdate",
          type: "switch",
          binding: { store: "settings", path: "system.update.autoCheck" },
          defaultValue: true,
        },
        {
          key: "checkUpdate",
          type: "button",
          action: () => useUpdateStore().checkManually(),
        },
      ],
    },
    {
      id: "debug",
      items: [
        {
          key: "showPerformanceMonitor",
          type: "switch",
          binding: { store: "settings", path: "appearance.showPerformanceMonitor" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "backupReset",
      items: [
        {
          key: "storageManager",
          type: "custom",
          component: StorageManager,
          fullWidth: true,
          keywords: ["backup.label", "restore.label", "resetSettings.label", "resetAll.label"],
        },
      ],
    },
  ],
};

export default generalCategory;
