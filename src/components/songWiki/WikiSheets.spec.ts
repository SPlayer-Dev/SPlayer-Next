import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WikiSheets from "./WikiSheets.vue";

const mocks = vi.hoisted(() => ({
  fetchSheetPreview: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/apis/song/wiki", () => ({ fetchSheetPreview: mocks.fetchSheetPreview }));
vi.mock("@/composables/useToast", () => ({ toast: { error: mocks.toastError } }));

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
        SButton: { template: "<button><slot/></button>" },
        SDialog: { template: "<div><slot/></div>" },
        IconLucideChevronDown: { template: "<i/>" },
      },
    },
  });

describe("WikiSheets 交互链路", () => {
  it("点击乐谱展开并渲染预览图", async () => {
    mocks.fetchSheetPreview.mockResolvedValue([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
    const wrapper = mountSheets();
    expect(wrapper.findAll("img").filter((i) => i.attributes("src"))).toHaveLength(0);

    await wrapper.findAll("button")[0].trigger("click");
    expect(mocks.fetchSheetPreview).toHaveBeenCalledWith("13466");
    await flushPromises();

    const imgs = wrapper.findAll("img").filter((i) => i.attributes("src"));
    expect(imgs).toHaveLength(2);
    expect(wrapper.text()).not.toContain("songWiki.sheet.empty");
    wrapper.unmount();
  });

  it("空预览显示暂无内容且不重复请求", async () => {
    mocks.fetchSheetPreview.mockResolvedValue([]);
    const wrapper = mountSheets();
    const first = wrapper.findAll("button")[0];
    await first.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("songWiki.sheet.empty");

    await first.trigger("click");
    await first.trigger("click");
    await flushPromises();
    expect(mocks.fetchSheetPreview).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("请求失败显示重试，重试成功后渲染图片", async () => {
    mocks.fetchSheetPreview.mockRejectedValueOnce(new Error("ipc failed"));
    const wrapper = mountSheets();
    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(mocks.toastError).toHaveBeenCalled();

    mocks.fetchSheetPreview.mockResolvedValueOnce(["https://example.com/a.png"]);
    const retry = wrapper.findAll("button").find((button) => button.text() === "common.retry");
    expect(retry).toBeTruthy();
    await retry!.trigger("click");
    await flushPromises();
    expect(wrapper.findAll("img").filter((i) => i.attributes("src"))).toHaveLength(1);
    wrapper.unmount();
  });
});
