import type { SettingCategory } from "@/types/settings-schema";
import ExternalApiPanel from "@/components/settings/custom/ExternalApiPanel.vue";
import IconLucideGlobe from "~icons/lucide/globe";

const servicesCategory: SettingCategory = {
  id: "services",
  icon: IconLucideGlobe,
  sections: [
    {
      id: "media",
      items: [
        {
          key: "systemMediaControls",
          type: "switch",
          binding: { store: "settings", path: "system.media.systemMediaControls" },
          defaultValue: true,
        },
      ],
    },
    {
      id: "discord",
      items: [
        {
          key: "discordEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.media.discord.enabled" },
          defaultValue: false,
          children: [
            {
              key: "discordShowWhenPaused",
              type: "switch",
              binding: { store: "settings", path: "system.media.discord.showWhenPaused" },
              defaultValue: false,
            },
            {
              key: "discordDisplayMode",
              type: "select",
              binding: { store: "settings", path: "system.media.discord.displayMode" },
              options: [
                { value: "name", labelKey: "settings.discordDisplayMode.name" },
                { value: "details", labelKey: "settings.discordDisplayMode.details" },
                { value: "state", labelKey: "settings.discordDisplayMode.state" },
              ],
              defaultValue: "name",
            },
          ],
        },
      ],
    },
    {
      id: "externalApi",
      tag: { text: "Beta" },
      items: [
        {
          key: "externalApiEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.externalApi.enabled" },
          defaultValue: false,
          children: [
            {
              key: "externalApiWs",
              type: "switch",
              binding: { store: "settings", path: "system.externalApi.wsEnabled" },
              defaultValue: false,
            },
            {
              key: "externalApiPort",
              type: "number",
              binding: { store: "settings", path: "system.externalApi.port" },
              min: 1024,
              max: 65535,
              defaultValue: 14558,
            },
            {
              key: "externalApiPanel",
              type: "custom",
              component: ExternalApiPanel,
              fullWidth: true,
              keywords: ["settings.externalApi.endpoint", "settings.externalApi.restart"],
            },
          ],
        },
      ],
    },
  ],
};

export default servicesCategory;
