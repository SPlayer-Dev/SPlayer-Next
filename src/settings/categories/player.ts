import type { SettingCategory } from "@/types/settings-schema";
import DeviceSelector from "@/components/settings/custom/DeviceSelector.vue";
import { isWin } from "@/utils/config";
import IconLucidePlay from "~icons/lucide/play";

const playerCategory: SettingCategory = {
  id: "player",
  icon: IconLucidePlay,
  sections: [
    {
      id: "playControl",
      items: [
        {
          key: "autoPlay",
          type: "switch",
          binding: { store: "settings", path: "system.player.autoPlay" },
          defaultValue: true,
        },
        {
          key: "rememberLastTrack",
          type: "switch",
          binding: { store: "settings", path: "system.player.rememberLastTrack" },
          defaultValue: false,
        },
        {
          key: "fadeEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.player.fadeEnabled" },
          defaultValue: true,
          children: [
            {
              key: "fadeDuration",
              type: "slider",
              binding: { store: "settings", path: "system.player.fadeDuration" },
              min: 100,
              max: 600,
              step: 100,
              defaultValue: 200,
              marks: { 100: "100", 200: "200", 600: "600" },
            },
          ],
        },
        {
          key: "loudnessNormalization",
          type: "switch",
          binding: { store: "settings", path: "system.player.loudnessNormalization" },
          defaultValue: false,
          tag: { text: "Beta" },
        },
      ],
    },
    {
      id: "audioSource",
      items: [
        {
          key: "songLevel",
          type: "select",
          binding: { store: "settings", path: "player.songLevel" },
          options: [
            { value: "lq", labelKey: "settings.songLevel.lq" },
            { value: "sq", labelKey: "settings.songLevel.sq" },
            { value: "hq", labelKey: "settings.songLevel.hq" },
            { value: "lossless", labelKey: "settings.songLevel.lossless" },
            { value: "hi-res", labelKey: "settings.songLevel.hi-res" },
          ],
          defaultValue: "hq",
        },
        {
          key: "allowTrialPlay",
          type: "switch",
          binding: { store: "settings", path: "player.allowTrialPlay" },
          defaultValue: false,
        },
        {
          key: "preloadNextTrack",
          type: "switch",
          binding: { store: "settings", path: "player.preloadNextTrack" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "scrobble",
      tag: { text: "Beta" },
      items: [
        {
          key: "neteaseScrobbleEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.system.neteaseScrobbleEnabled" },
          defaultValue: false,
          children: [
            {
              key: "neteaseScrobbleMode",
              type: "select",
              binding: { store: "settings", path: "system.system.neteaseScrobbleMode" },
              options: [
                { value: "legacy", labelKey: "settings.neteaseScrobbleMode.legacy" },
                { value: "ncbl", labelKey: "settings.neteaseScrobbleMode.ncbl" },
              ],
              defaultValue: "ncbl",
            },
          ],
        },
      ],
    },
    {
      id: "musicSpectrum",
      tag: { text: "Beta" },
      items: [
        {
          key: "enableSpectrum",
          type: "switch",
          binding: { store: "settings", path: "player.enableSpectrum" },
          defaultValue: false,
          children: [
            {
              key: "spectrumBarWidth",
              type: "slider",
              binding: { store: "settings", path: "player.spectrumBarWidth" },
              min: 1,
              max: 12,
              step: 1,
              defaultValue: 4,
              marks: { 1: "1", 4: "4", 8: "8", 12: "12" },
            },
            {
              key: "reverseSpectrum",
              type: "switch",
              binding: { store: "settings", path: "player.reverseSpectrum" },
              defaultValue: false,
            },
          ],
        },
      ],
    },

    {
      id: "device",
      items: [
        {
          key: "outputDevice",
          type: "custom",
          component: DeviceSelector,
        },
        {
          key: "audioOutputMode",
          type: "select",
          binding: { store: "settings", path: "system.player.audioOutputMode" },
          options: [
            { value: "shared", labelKey: "settings.audioOutputMode.shared" },
            { value: "exclusive", labelKey: "settings.audioOutputMode.exclusive" },
          ],
          defaultValue: "shared",
          visible: () => isWin,
        },
        {
          key: "pauseOnDeviceSwitch",
          type: "switch",
          binding: { store: "settings", path: "player.pauseOnDeviceSwitch" },
          defaultValue: false,
          action: (enabled) =>
            window.api.player.setPauseOnDeviceSwitch(Boolean(enabled)).then(() => {}),
        },
      ],
    },
  ],
};

export default playerCategory;
