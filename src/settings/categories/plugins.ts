import type { SettingCategory } from "@/types/settings-schema";
import PluginImport from "@/components/settings/custom/PluginImport.vue";
import PluginList from "@/components/settings/custom/PluginList.vue";
import IconLucidePuzzle from "~icons/lucide/puzzle";

const pluginsCategory: SettingCategory = {
  id: "plugins",
  icon: IconLucidePuzzle,
  sections: [
    {
      id: "pluginManage",
      tag: { text: "Beta" },
      items: [
        {
          key: "pluginImport",
          type: "custom",
          component: PluginImport,
          fullWidth: true,
          descriptionKey: "settings.plugins.hint",
          keywords: ["settings.plugins.importLocal", "settings.plugins.importFromUrl"],
        },
      ],
    },
    {
      id: "pluginsList",
      items: [
        {
          key: "pluginList",
          type: "custom",
          component: PluginList,
          fullWidth: true,
          keywords: ["settings.plugins.uninstall", "settings.plugins.install"],
        },
      ],
    },
  ],
};

export default pluginsCategory;
