import { describe, expect, it, vi } from "vitest";
import type { SettingCategory } from "@/types/settings-schema";
import { searchSettings } from "./searchSettings";

const fixtures = vi.hoisted(() => ({ schema: [] as SettingCategory[] }));
vi.mock("@/settings/schema", () => ({ settingsSchema: fixtures.schema }));

const messages: Record<string, string> = {
  "settings.group.player": "播放",
  "settings.fade.label": "淡入淡出",
  "settings.fadeDuration.label": "淡入时长",
  "settings.hiddenItem.label": "隐藏项",
  "settings.keywordItem.label": "均衡器",
  "settings.keywordItem.kw": "EQ",
};

const translate = (key: string): string => messages[key] ?? key;
const hasKey = (key: string): boolean => key in messages;

fixtures.schema.push({
  id: "player",
  icon: {},
  sections: [
    {
      id: "audio",
      items: [
        {
          key: "fade",
          type: "switch",
          children: [{ key: "fadeDuration", type: "custom" }],
        },
        { key: "hiddenItem", type: "custom", visible: () => false },
        { key: "keywordItem", type: "custom", keywords: ["settings.keywordItem.kw"] },
      ],
    },
  ],
} as SettingCategory);

describe("searchSettings", () => {
  it("子项带上父项键名", () => {
    const [result] = searchSettings("淡入时长", translate, hasKey);
    expect(result).toMatchObject({
      categoryId: "player",
      itemKey: "fadeDuration",
      parentKeys: ["fade"],
      categoryLabel: "播放",
    });
  });

  it("跳过不可见项", () => {
    expect(searchSettings("隐藏", translate, hasKey)).toEqual([]);
  });

  it("关键词可命中且不区分大小写", () => {
    expect(searchSettings("eq", translate, hasKey).map((item) => item.itemKey)).toEqual([
      "keywordItem",
    ]);
  });

  it("空关键词不返回结果", () => {
    expect(searchSettings("  ", translate, hasKey)).toEqual([]);
  });
});
