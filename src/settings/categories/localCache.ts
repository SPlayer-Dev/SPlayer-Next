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
      id: "songCache",
      items: [
        {
          key: "enableSongCache",
          type: "switch",
          binding: { store: "settings", path: "system.cache.songCache.enabled" },
          defaultValue: false,
          confirm: {
            when: (next) => {
              if (next !== false) return false;
              const player = useSettingsStore().player;
              return player.preloadNextTrack || player.transitionMode !== "none";
            },
            titleKey: "settings.confirm.disableSongCacheTitle",
            contentKey: "settings.confirm.disableSongCacheContent",
            type: "warning",
          },
          action: (enabled) => {
            if (enabled !== false) return;
            const player = useSettingsStore().player;
            player.preloadNextTrack = false;
            player.transitionMode = "none";
          },
          children: [
            {
              key: "cacheStreaming",
              type: "switch",
              binding: { store: "settings", path: "system.cache.songCache.cacheStreaming" },
              defaultValue: false,
            },
            {
              key: "songCacheSizeLimit",
              type: "slider",
              binding: { store: "settings", path: "system.cache.songCache.sizeLimitGb" },
              min: 0,
              max: 50,
              step: 1,
              marks: {
                0: "∞",
                10: "10G",
                20: "20G",
                50: "50G",
              },
              defaultValue: 10,
            },
          ],
          childrenCondition: () => useSettingsStore().system.cache?.songCache?.enabled === true,
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
          keywords: ["settings.cacheDir.label", "settings.fileClearAll.label"],
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
          keywords: ["settings.dbClearAll.label"],
        },
      ],
    },
  ],
};

export default localCacheCategory;
