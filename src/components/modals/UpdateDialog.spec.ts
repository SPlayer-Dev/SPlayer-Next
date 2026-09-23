import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // @ts-expect-error mock build defines missing in vitest.config.ts
  globalThis.__COMMIT_HASH__ = "test-hash";
  // @ts-expect-error mock build defines missing in vitest.config.ts
  globalThis.__COMMIT_DATE__ = "2026-01-01";
  window.api = {
    system: {
      platform: "win32",
      installType: "nsis",
    },
    update: {
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      openDownloadPage: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    },
  } as unknown as typeof window.api;
});

import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { UpdateEvent, UpdateMeta } from "@shared/types/update";
import i18n from "@/i18n";
import { useUpdateStore } from "@/stores/update";
import UpdateDialog from "./UpdateDialog.vue";

const mockMeta: UpdateMeta = {
  version: "1.2.0",
  releaseNotes: "### Features\n- Great things",
  releaseDate: "2026-03-01T00:00:00.000Z",
  size: 10_000_000,
};

describe("UpdateDialog", () => {
  let eventHandler: (event: UpdateEvent) => void;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    window.api.update.onEvent = vi.fn((cb: (event: UpdateEvent) => void) => {
      eventHandler = cb;
      return () => {};
    });
  });

  const mountDialog = () => {
    return mount(UpdateDialog, {
      global: {
        plugins: [i18n],
        stubs: {
          SDialog: {
            props: ["open", "title"],
            template: `<div v-if="open" class="dialog-stub"><slot /><slot name="footer" :close="() => {}" /></div>`,
          },
          SButton: {
            props: ["variant", "type", "disabled"],
            emits: ["click"],
            template: `<button :disabled="disabled" :data-type="type" @click="$emit('click')"><slot /></button>`,
          },
          STag: { template: `<span><slot /></span>` },
          IconLucideArrowRight: true,
          IconLucideCalendar: true,
          IconLucideHardDrive: true,
        },
      },
    });
  };

  it("当 phase 为 available 且存在 meta 时显示下载按钮并可触发下载", async () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const downloadBtn = buttons.find((b) => b.text().trim() === "下载");
    expect(downloadBtn).toBeDefined();

    await downloadBtn?.trigger("click");
    expect(window.api.update.download).toHaveBeenCalledTimes(1);
  });

  it("当 meta 为 null 时，绝不渲染下载、安装或前往下载页按钮（无陈旧回退）", () => {
    const store = useUpdateStore();
    store.dialogOpen = true;
    store.canInstall = true;
    store.phase = "available";
    store.meta = null;

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const downloadBtn = buttons.find((b) => b.text().trim() === "下载");
    const installBtn = buttons.find((b) => b.text().trim() === "立即重启安装");
    const goDownloadBtn = buttons.find((b) => b.text().trim() === "前往下载页");

    expect(downloadBtn).toBeUndefined();
    expect(installBtn).toBeUndefined();
    expect(goDownloadBtn).toBeUndefined();
    // 仅有“稍后”操作
    expect(buttons).toHaveLength(1);
    expect(buttons[0].text().trim()).toBe("稍后");
  });

  it("当 phase 为 checking 时，弹窗中仅提供禁用态检查中与稍后按钮，不可执行下载或安装", () => {
    const store = useUpdateStore();
    store.dialogOpen = true;
    store.phase = "checking";
    store.meta = null;

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const checkingBtn = buttons.find((b) => b.text().trim() === "检查中");
    const downloadBtn = buttons.find((b) => b.text().trim() === "下载");
    const installBtn = buttons.find((b) => b.text().trim() === "立即重启安装");

    expect(checkingBtn).toBeDefined();
    expect(checkingBtn?.attributes("disabled")).toBeDefined();
    expect(downloadBtn).toBeUndefined();
    expect(installBtn).toBeUndefined();
  });

  it("在 macOS / Portable 平台 (!canInstall) 下，错误状态必须优先展示重试按钮，而不是仅显示下载链接", async () => {
    useUpdateStore();
    // 模拟 macOS 平台发现更新（canInstall: false）
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: false,
    });

    // 发生检查错误
    eventHandler({
      type: "error",
      message: "检查失败",
      manual: true,
      source: "check",
    });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const retryBtn = buttons.find((b) => b.text().trim() === "重试");
    const goDownloadBtn = buttons.find((b) => b.text().trim() === "前往下载页");

    // 错误态优先于 !canInstall && meta
    expect(retryBtn).toBeDefined();
    expect(goDownloadBtn).toBeUndefined();

    await retryBtn?.trigger("click");
    expect(window.api.update.check).toHaveBeenCalledWith(true);
  });

  it("在 macOS / Portable 平台 (!canInstall) 下，checking 状态优先展示检查中禁用按钮", () => {
    const store = useUpdateStore();
    // 模拟已有 meta 但正在 checking
    store.dialogOpen = true;
    store.canInstall = false;
    store.phase = "checking";
    store.meta = mockMeta;

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const checkingBtn = buttons.find((b) => b.text().trim() === "检查中");
    const goDownloadBtn = buttons.find((b) => b.text().trim() === "前往下载页");

    expect(checkingBtn).toBeDefined();
    expect(checkingBtn?.attributes("disabled")).toBeDefined();
    expect(goDownloadBtn).toBeUndefined();
  });

  it("当 phase 为 downloaded 且存在 meta 时显示立即安装按钮", async () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "downloaded", meta: mockMeta });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const installBtn = buttons.find((b) => b.text().trim() === "立即重启安装");
    expect(installBtn).toBeDefined();

    await installBtn?.trigger("click");
    expect(window.api.update.install).toHaveBeenCalledTimes(1);
  });

  it("当 phase 为 downloading 时显示禁用态下载中进度按钮", () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "progress", percent: 80 });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const downloadingBtn = buttons.find((b) => b.text().includes("下载中 80%"));
    expect(downloadingBtn).toBeDefined();
    expect(downloadingBtn?.attributes("disabled")).toBeDefined();
  });

  it("当检查失败时重试按钮触发 checkManually，而不是推测为 download", async () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });
    eventHandler({
      type: "error",
      message: "检查网络异常",
      manual: true,
      source: "check",
    });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const retryBtn = buttons.find((b) => b.text().trim() === "重试");
    expect(retryBtn).toBeDefined();

    await retryBtn?.trigger("click");
    expect(window.api.update.check).toHaveBeenCalledWith(true);
    expect(window.api.update.download).not.toHaveBeenCalled();
  });

  it("当下载失败时重试按钮触发 download", async () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });
    eventHandler({
      type: "error",
      message: "下载中断",
      manual: true,
      source: "download",
    });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const retryBtn = buttons.find((b) => b.text().trim() === "重试");
    expect(retryBtn).toBeDefined();

    await retryBtn?.trigger("click");
    expect(window.api.update.download).toHaveBeenCalledTimes(1);
    expect(window.api.update.check).not.toHaveBeenCalledWith(true);
  });

  it("当安装失败时重试按钮触发 install，不盲目重试下载", async () => {
    useUpdateStore();
    eventHandler({
      type: "available",
      meta: mockMeta,
      manual: false,
      canInstall: true,
    });
    eventHandler({ type: "downloaded", meta: mockMeta });
    eventHandler({
      type: "error",
      message: "权限不足安装失败",
      manual: true,
      source: "install",
    });

    const wrapper = mountDialog();
    const buttons = wrapper.findAll("button");
    const retryBtn = buttons.find((b) => b.text().trim() === "重试");
    expect(retryBtn).toBeDefined();

    await retryBtn?.trigger("click");
    expect(window.api.update.install).toHaveBeenCalledTimes(1);
    expect(window.api.update.download).not.toHaveBeenCalled();
  });
});
