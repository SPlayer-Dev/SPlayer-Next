import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import ExternalApiPanel from "@/components/settings/custom/ExternalApiPanel.vue";
import LastfmPanel from "@/components/settings/custom/LastfmPanel.vue";
import IconLucideGlobe from "~icons/lucide/globe";

const servicesCategory: SettingCategory = {
  id: "services",
  icon: IconLucideGlobe,
  sections: [
    {
      id: "network",
      items: [
        {
          key: "neteaseRealIp",
          type: "switch",
          binding: { store: "settings", path: "system.system.neteaseRealIp" },
          defaultValue: false,
        },
      ],
    },
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
        },
        {
          key: "discordShowWhenPaused",
          type: "switch",
          binding: { store: "settings", path: "system.media.discord.showWhenPaused" },
          defaultValue: false,
          visible: () => useSettingsStore().system.media.discord.enabled,
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
          visible: () => useSettingsStore().system.media.discord.enabled,
        },
      ],
    },
    {
      id: "lastfm",
      items: [
        {
          key: "lastfmEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.enabled" },
          defaultValue: false,
        },
        {
          key: "lastfmAccount",
          type: "custom",
          component: LastfmPanel,
          fullWidth: true,
          keywords: ["settings.lastfm.connect", "settings.lastfm.disconnect"],
          visible: () => useSettingsStore().system.lastfm.enabled,
        },
        {
          key: "lastfmScrobble",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.scrobble" },
          defaultValue: true,
          visible: () => useSettingsStore().system.lastfm.enabled,
        },
        {
          key: "lastfmNowPlaying",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.nowPlaying" },
          defaultValue: true,
          visible: () => useSettingsStore().system.lastfm.enabled,
        },
        {
          key: "lastfmLoveSync",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.loveSync" },
          defaultValue: true,
          visible: () => useSettingsStore().system.lastfm.enabled,
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
        },
        {
          key: "externalApiWs",
          type: "switch",
          binding: { store: "settings", path: "system.externalApi.wsEnabled" },
          defaultValue: false,
          visible: () => useSettingsStore().system.externalApi.enabled,
        },
        {
          key: "externalApiAllowLan",
          type: "switch",
          binding: { store: "settings", path: "system.externalApi.allowLan" },
          defaultValue: false,
          visible: () => useSettingsStore().system.externalApi.enabled,
        },
        {
          key: "externalApiPort",
          type: "number",
          binding: { store: "settings", path: "system.externalApi.port" },
          min: 1024,
          max: 65535,
          defaultValue: 14558,
          visible: () => useSettingsStore().system.externalApi.enabled,
        },
        {
          key: "externalApiPanel",
          type: "custom",
          component: ExternalApiPanel,
          fullWidth: true,
          keywords: ["settings.externalApi.endpoint", "settings.externalApi.restart"],
          visible: () => useSettingsStore().system.externalApi.enabled,
        },
      ],
    },
  ],
};

export default servicesCategory;
