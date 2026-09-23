import type { SettingCategory } from "@/types/settings-schema";
import McpConfigDialog from "@/components/settings/custom/McpConfigDialog.vue";
import McpStatusCard from "@/components/settings/custom/McpStatusCard.vue";
import AiModelConfig from "@/components/settings/custom/AiModelConfig.vue";
import IconLucideBot from "~icons/lucide/bot";

const aiIntegrationCategory: SettingCategory = {
  id: "aiIntegration",
  icon: IconLucideBot,
  sections: [
    {
      id: "aiModel",
      tag: { text: "未实现", type: "warning" },
      items: [
        {
          key: "aiModelConfig",
          type: "custom",
          component: AiModelConfig,
          fullWidth: true,
          searchable: false,
        },
      ],
    },
    {
      id: "mcp",
      tag: { text: "Beta" },
      items: [
        {
          key: "mcpStatusCard",
          type: "custom",
          component: McpStatusCard,
          fullWidth: true,
          searchable: false,
        },
        {
          key: "mcpEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.mcp.enabled" },
          defaultValue: false,
          hideChildren: true,
          children: [
            {
              key: "mcpPort",
              type: "number",
              binding: { store: "settings", path: "system.mcp.port" },
              min: 1024,
              max: 65535,
              defaultValue: 14559,
            },
            {
              key: "mcpConfigDetails",
              type: "custom",
              component: McpConfigDialog,
            },
          ],
        },
      ],
    },
  ],
};

export default aiIntegrationCategory;
