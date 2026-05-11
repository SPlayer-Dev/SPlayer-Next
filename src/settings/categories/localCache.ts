import type { SettingCategory } from "@/types/settings-schema";
import CacheManager from "@/components/settings/custom/CacheManager.vue";
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
          key: "cacheManager",
          type: "custom",
          component: CacheManager,
          fullWidth: true,
          keywords: ["cacheDir.label", "cacheUsage.label", "cacheClearAll.label"],
        },
      ],
    },
  ],
};

export default localCacheCategory;
