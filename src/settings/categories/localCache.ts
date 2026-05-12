import type { SettingCategory } from "@/types/settings-schema";
import FileCacheManager from "@/components/settings/custom/FileCacheManager.vue";
import DbCacheManager from "@/components/settings/custom/DbCacheManager.vue";
import IconLucideHardDrive from "~icons/lucide/hard-drive";

const localCacheCategory: SettingCategory = {
  id: "localCache",
  icon: IconLucideHardDrive,
  sections: [
    {
      id: "localFiles",
      items: [
        {
          key: "enableLocalTTMLOverride",
          type: "switch",
          binding: { store: "settings", path: "system.localLyric.enableLocalTTMLOverride" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
      ],
    },
    {
      id: "cache",
      items: [
        {
          key: "fileCacheManager",
          type: "custom",
          component: FileCacheManager,
          fullWidth: true,
          keywords: ["cacheDir.label", "fileClearAll.label"],
        },
      ],
    },
    {
      id: "database",
      items: [
        {
          key: "dbCacheManager",
          type: "custom",
          component: DbCacheManager,
          fullWidth: true,
          keywords: ["dbClearAll.label"],
        },
      ],
    },
  ],
};

export default localCacheCategory;
