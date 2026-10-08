import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { reactive } from "vue";
import UpdateDialog from "./UpdateDialog.vue";

const mocks = vi.hoisted(() => ({
  store: {
    phase: "available",
    errorSource: undefined as string | undefined,
    canInstall: true,
    dialogOpen: true,
    meta: null,
    percent: 23,
    download: vi.fn(),
    checkManually: vi.fn(),
    install: vi.fn(),
    openDownloadPage: vi.fn(),
  },
}));
vi.mock("@/stores/update", () => ({ useUpdateStore: () => mocks.store }));
vi.mock("@/utils/config", () => ({ APP_VERSION: "1.0.0", IS_APPX: false }));
vi.mock("@/utils/format", () => ({ formatFileSize: () => "0 B" }));
const mountDialog = () =>
  mount(UpdateDialog, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SDialog: { template: '<div><slot/><slot name="footer" :close="() => {}"/></div>' },
        SButton: { props: ["disabled"], template: '<button :disabled="disabled"><slot/></button>' },
      },
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store = reactive({ ...mocks.store, phase: "available", errorSource: undefined });
});
describe("更新弹窗的阶段动作", () => {
  it("可用版本显示下载操作", async () => {
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "update.download")!
      .trigger("click");
    expect(mocks.store.download).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it("安装失败仍展示安装重试，不误触发重新下载", async () => {
    mocks.store.phase = "error";
    mocks.store.errorSource = "install";
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "update.installNow")!
      .trigger("click");
    expect(mocks.store.install).toHaveBeenCalledOnce();
    expect(mocks.store.download).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("下载失败重新检查，避免继续下载已删除的 Nightly", async () => {
    mocks.store.phase = "error";
    mocks.store.errorSource = "download";
    const wrapper = mountDialog();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "settings.about.checkUpdate")!
      .trigger("click");
    expect(mocks.store.checkManually).toHaveBeenCalledOnce();
    expect(mocks.store.download).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(["checking", "cancelling", "idle"])("%s 不提供下载或安装操作", (phase) => {
    mocks.store.phase = phase;
    const wrapper = mountDialog();
    expect(wrapper.text()).not.toContain("update.installNow");
    expect(wrapper.findAll("button").some((button) => button.text() === "update.download")).toBe(
      false,
    );
    wrapper.unmount();
  });
});
