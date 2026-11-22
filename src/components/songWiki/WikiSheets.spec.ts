import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WikiSheets from "./WikiSheets.vue";

const mocks = vi.hoisted(() => ({
  fetchSheetPreview: vi.fn(),
}));

vi.mock("@/apis/song/wiki", () => ({ fetchSheetPreview: mocks.fetchSheetPreview }));

const SHEETS = [
  { id: "13466", name: "Guitar, 钢琴, 声音", totalPageSize: 5 },
  { id: "174925", name: "钢琴谱", totalPageSize: 7 },
];

const mountSheets = () =>
  mount(WikiSheets, {
    props: { sheets: SHEETS },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SLoading: { template: "<div class='loading-stub'/>" },
        SButton: { template: '<button v-bind="$attrs"><slot name="icon"/><slot/></button>' },
        SDialog: { template: "<div><slot/></div>" },
        IconLucideChevronRight: { template: "<i/>" },
        IconLucideMusic: { template: "<i/>" },
        IconLucideZoomIn: { template: "<i/>" },
        IconLucideZoomOut: { template: "<i/>" },
      },
    },
  });

const previewImages = (wrapper: ReturnType<typeof mountSheets>) =>
  wrapper.findAll("img").filter((img) => img.attributes("src"));

describe("WikiSheets 交互链路", () => {
  it("点击乐谱直接打开查看器并渲染预览", async () => {
    mocks.fetchSheetPreview.mockResolvedValue(["https://example.com/a.png"]);
    const wrapper = mountSheets();
    expect(previewImages(wrapper)).toHaveLength(0);

    await wrapper.findAll("button")[0].trigger("click");
    expect(mocks.fetchSheetPreview).toHaveBeenCalledWith("13466");
    await flushPromises();

    const images = previewImages(wrapper);
    expect(images).toHaveLength(1);
    expect(images[0].attributes("src")).toBe("https://example.com/a.png");
    wrapper.unmount();
  });

  it("多页乐谱依次纵向渲染所有页", async () => {
    mocks.fetchSheetPreview.mockResolvedValue([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    const wrapper = mountSheets();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    expect(previewImages(wrapper).map((img) => img.attributes("src"))).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    wrapper.unmount();
  });

  it("键盘缩放作用于整份乐谱", async () => {
    mocks.fetchSheetPreview.mockResolvedValue([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    const wrapper = mountSheets();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    await flushPromises();
    expect(wrapper.text()).toContain("125%");
    expect(previewImages(wrapper)).toHaveLength(2);
    wrapper.unmount();
  });

  it("空预览显示暂无内容且不重复请求", async () => {
    mocks.fetchSheetPreview.mockResolvedValue([]);
    const wrapper = mountSheets();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("songWiki.sheet.empty");

    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(mocks.fetchSheetPreview).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("请求失败显示重试，重试成功后渲染图片", async () => {
    mocks.fetchSheetPreview.mockRejectedValueOnce(new Error("ipc failed"));
    const wrapper = mountSheets();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("songWiki.sheet.loadFailed");

    mocks.fetchSheetPreview.mockResolvedValueOnce(["https://example.com/a.png"]);
    const retry = wrapper.findAll("button").find((button) => button.text() === "common.retry");
    expect(retry).toBeTruthy();
    await retry!.trigger("click");
    await flushPromises();
    expect(previewImages(wrapper)).toHaveLength(1);
    wrapper.unmount();
  });
});
