import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { SettingCategory } from "@/types/settings-schema";
import zhCN from "@/i18n/locales/zh-CN.json";
import enUS from "@/i18n/locales/en-US.json";
import SInput from "@/components/ui/SInput.vue";
import SettingsSearch from "./SettingsSearch.vue";

const fixtures = vi.hoisted(() => ({ schema: [] as SettingCategory[] }));
vi.mock("@/settings/schema", () => ({ settingsSchema: fixtures.schema }));

let wrapper: VueWrapper;

/**
 * 挂载指定语言的设置搜索
 * @param locale - 界面语言
 */
const mountSearch = (locale: "zh-CN" | "en-US" = "zh-CN") => {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: { "zh-CN": zhCN, "en-US": enUS },
  });
  wrapper = mount(SettingsSearch, {
    global: {
      plugins: [i18n],
      components: { SInput },
      stubs: { IconLucideSearch: true, IconLucideX: true },
    },
  });
  return i18n;
};

/**
 * 输入搜索词
 * @param query - 搜索词
 */
const search = async (query: string) => {
  await wrapper.get("input").trigger("focus");
  await wrapper.get("input").setValue(query);
};

beforeEach(() => {
  fixtures.schema.splice(0, fixtures.schema.length, {
    id: "other",
    icon: {},
    sections: [
      {
        id: "platformLogin",
        items: [
          {
            key: "qmAccount",
            type: "custom",
            descriptionKey: "settings.platformLogin.desc",
            keywords: ["settings.platformLogin.title"],
          },
          {
            key: "kgAccount",
            type: "custom",
            descriptionKey: "settings.platformLogin.desc",
            keywords: ["settings.platformLogin.title"],
          },
          { key: "downloadDir", type: "custom" },
          {
            key: "pluginImport",
            type: "custom",
            descriptionKey: "settings.plugins.hint",
          },
        ],
      },
    ],
  });
});

afterEach(() => wrapper.unmount());

describe("设置搜索文案", () => {
  it.each(["zh-CN", "en-US"] as const)("%s 显示账号标题和组件共用的描述", async (locale) => {
    mountSearch(locale);
    await search(locale === "zh-CN" ? "登录" : "account");
    const messages = locale === "zh-CN" ? zhCN : enUS;
    expect(wrapper.text()).toContain(messages.settings.qmAccount.label);
    expect(wrapper.text()).toContain(messages.settings.kgAccount.label);
    expect(wrapper.text()).toContain(messages.settings.platformLogin.desc);
    expect(wrapper.text()).not.toContain("settings.");
  });

  it.each(["zh-CN", "en-US"] as const)("%s 没有描述的下载目录仍可搜索", async (locale) => {
    mountSearch(locale);
    const messages = locale === "zh-CN" ? zhCN : enUS;
    await search(messages.settings.downloadDir.label);
    expect(wrapper.findAll(".font-medium").map((item) => item.text())).toEqual([
      messages.settings.downloadDir.label,
    ]);
    expect(wrapper.find(".truncate").exists()).toBe(false);
  });

  it("缺失的标题、描述和关键词不会显示或参与匹配", async () => {
    fixtures.schema[0].sections![0].items.push(
      { key: "missingTitle", type: "custom", keywords: ["settings.platformLogin.title"] },
      { key: "pluginList", type: "custom", keywords: ["settings.missingKeyword"] },
    );
    mountSearch();
    await search("登录");
    expect(wrapper.findAll(".font-medium")).toHaveLength(2);
    await search("settings");
    expect(wrapper.findAll(".font-medium")).toHaveLength(0);
    expect(wrapper.text()).toContain(zhCN.common.noData);
  });

  it("切换语言后更新已有搜索结果", async () => {
    const i18n = mountSearch();
    await search("QQ");
    expect(wrapper.text()).toContain(zhCN.settings.qmAccount.label);
    i18n.global.locale.value = "en-US";
    await nextTick();
    expect(wrapper.text()).toContain(enUS.settings.qmAccount.label);
    expect(wrapper.text()).not.toContain(zhCN.settings.qmAccount.label);
  });

  it("递归搜索子项并携带父项供收起时定位", async () => {
    fixtures.schema[0].sections![0].items.push({
      key: "appearanceStyle",
      type: "select",
      searchable: false,
      hideChildren: true,
      children: [{ key: "backgroundBlur", type: "slider" }],
    });
    mountSearch();
    await search(zhCN.settings.backgroundBlur.label);
    await wrapper.get(".top-full .cursor-pointer").trigger("mousedown");
    expect(wrapper.emitted("select")).toEqual([["other", "backgroundBlur", ["appearanceStyle"]]]);
    expect((wrapper.get("input").element as HTMLInputElement).value).toBe("");
  });

  it("隐藏的分区和设置项连同子项不参与搜索", async () => {
    fixtures.schema[0].sections![0].items[0].visible = () => false;
    fixtures.schema[0].sections!.push({
      id: "appearanceStyle",
      visible: () => false,
      items: [{ key: "qmAccount", type: "custom" }],
    });
    fixtures.schema[0].sections![0].items.push({
      key: "appearanceStyle",
      type: "select",
      visible: () => false,
      children: [{ key: "qmAccount", type: "custom" }],
    });
    mountSearch();
    await search("QQ");
    expect(wrapper.findAll(".font-medium")).toHaveLength(0);
  });

  it("只有空格时不遮挡设置菜单", async () => {
    mountSearch();
    await search("   ");
    expect(wrapper.emitted("active-change")).toBeUndefined();
    expect(wrapper.find(".top-full").exists()).toBe(false);
  });
});
