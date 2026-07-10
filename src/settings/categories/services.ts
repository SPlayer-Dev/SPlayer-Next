import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
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
          key: "networkProxyProtocol",
          type: "select",
          binding: { store: "settings", path: "system.system.networkProxy.protocol" },
          options: [
            { value: "off", labelKey: "settings.networkProxyProtocol.off" },
            { value: "http", labelKey: "settings.networkProxyProtocol.http" },
            { value: "https", labelKey: "settings.networkProxyProtocol.https" },
            { value: "socks5", labelKey: "settings.networkProxyProtocol.socks5" },
          ],
          defaultValue: "off",
          childrenCondition: () => {
            const p = useSettingsStore().system.system.networkProxy.protocol;
            return p !== "off";
          },
          children: [
            {
              key: "networkProxyHost",
              type: "text",
              binding: { store: "settings", path: "system.system.networkProxy.host" },
              defaultValue: "127.0.0.1",
              placeholderKey: "settings.networkProxyHost.placeholder",
              disabled: () => useSettingsStore().system.system.networkProxy.protocol === "off",
            },
            {
              key: "networkProxyPort",
              type: "number",
              binding: { store: "settings", path: "system.system.networkProxy.port" },
              min: 1,
              max: 65535,
              defaultValue: 7890,
              disabled: () => useSettingsStore().system.system.networkProxy.protocol === "off",
            },
            {
              key: "networkProxyTest",
              type: "button",
              action: async () => {
                const { t } = i18n.global;
                try {
                  const ok = await window.api.system.testNetworkProxy();
                  if (ok) toast.success(t("settings.networkProxyTest.success"));
                  else toast.error(t("settings.networkProxyTest.failed"));
                } catch {
                  toast.error(t("settings.networkProxyTest.failed"));
                }
              },
            },
          ],
        },
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
      id: "lastfm",
      items: [
        {
          key: "lastfmEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.enabled" },
          defaultValue: false,
          children: [
            {
              key: "lastfmAccount",
              type: "custom",
              component: LastfmPanel,
              fullWidth: true,
              keywords: ["settings.lastfm.connect", "settings.lastfm.disconnect"],
            },
            {
              key: "lastfmScrobble",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.scrobble" },
              defaultValue: true,
            },
            {
              key: "lastfmNowPlaying",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.nowPlaying" },
              defaultValue: true,
            },
            {
              key: "lastfmLoveSync",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.loveSync" },
              defaultValue: true,
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
              key: "externalApiAllowLan",
              type: "switch",
              binding: { store: "settings", path: "system.externalApi.allowLan" },
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
