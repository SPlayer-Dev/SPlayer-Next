import type { SettingCategory } from "@/types/settings-schema";
import PluginManager from "@/components/settings/custom/PluginManager.vue";
import IconLucidePuzzle from "~icons/lucide/puzzle";

const pluginsCategory: SettingCategory = {
  id: "plugins",
  icon: IconLucidePuzzle,
  sections: [
    {
      id: "pluginsList",
      tag: { text: "Beta" },
      items: [
        {
          key: "pluginManager",
          type: "custom",
          component: PluginManager,
          fullWidth: true,
          keywords: [
            "settings.plugins.import",
            "settings.plugins.hint",
            "settings.plugins.uninstall",
          ],
        },
      ],
    },
  ],
};

export default pluginsCategory;
