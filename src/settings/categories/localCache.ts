import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
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
      id: "songCache",
      items: [
        {
          key: "enableSongCache",
          type: "switch",
          binding: { store: "settings", path: "system.cache.songCache.enabled" },
          defaultValue: false,
          children: [
            {
              key: "songCacheSizeLimit",
              type: "slider",
              binding: { store: "settings", path: "system.cache.songCache.sizeLimitMb" },
              min: 1024,
              max: 16384,
              step: 1024,
              marks: { 1024: "1G", 5120: "5G", 10240: "10G", 16384: "16G" },
              defaultValue: 5120,
            },
          ],
          childrenCondition: () =>
            useSettingsStore().system.cache?.songCache?.enabled === true,
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
