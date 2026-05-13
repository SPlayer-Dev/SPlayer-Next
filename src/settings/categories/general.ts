import type { SettingCategory } from "@/types/settings-schema";
import StorageManager from "@/components/settings/custom/StorageManager.vue";
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
          options: [
            { value: "zh-CN", labelKey: "settings.language.zhCN" },
            { value: "en-US", labelKey: "settings.language.enUS" },
          ],
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
          key: "taskbarProgress",
          type: "switch",
          binding: { store: "settings", path: "system.system.taskbarProgress" },
          defaultValue: true,
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
