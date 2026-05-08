import type { SettingCategory } from "@/types/settings-schema";
import StreamingServerList from "@/components/settings/custom/StreamingServerList.vue";
import IconLucideServer from "~icons/lucide/server";

const streamingCategory: SettingCategory = {
  id: "streaming",
  icon: IconLucideServer,
  sections: [
    {
      id: "servers",
      items: [
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

export default streamingCategory;
