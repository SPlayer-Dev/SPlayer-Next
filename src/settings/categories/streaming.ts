import type { SettingCategory } from "@/types/settings-schema";
import StreamingServerList from "@/components/settings/custom/StreamingServerList.vue";
import IconLucideLibrary from "~icons/lucide/library";

const mediaSourceCategory: SettingCategory = {
  id: "mediaSource",
  icon: IconLucideLibrary,
  sections: [
    {
      id: "streaming",
      items: [
        {
          key: "streamingEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.streaming.enabled" },
          defaultValue: true,
        },
        {
          key: "streamingServerList",
          type: "custom",
          component: StreamingServerList,
          fullWidth: true,
          keywords: ["streaming.server.add", "streaming.server.test", "streaming.server.connect"],
        },
      ],
    },
  ],
};

export default mediaSourceCategory;
