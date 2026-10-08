import type { SettingSection } from "@/types/settings-schema";
import { UPDATE_CHANNELS } from "@shared/types/settings";
import { IS_APPX } from "@/utils/config";
import { useUpdateStore } from "@/stores/update";

export const updateSection: SettingSection = {
  id: "update",
  visible: () => !IS_APPX,
  items: [
    {
      key: "updateChannel",
      type: "select",
      disabled: () => useUpdateStore().phase === "installing",
      binding: { store: "settings", path: "system.update.channel" },
      options: UPDATE_CHANNELS.map((channel) => ({
        value: channel,
        labelKey: `settings.updateChannel.${channel}`,
      })),
      defaultValue: "stable",
      confirm: {
        when: (next) => next === "beta" || next === "alpha" || next === "nightly",
        titleKey: "settings.confirm.testChannelTitle",
        contentKey: "settings.confirm.testChannelContent",
        type: "warning",
      },
    },
    {
      key: "autoCheckUpdate",
      type: "switch",
      binding: { store: "settings", path: "system.update.autoCheck" },
      defaultValue: true,
    },
  ],
};
