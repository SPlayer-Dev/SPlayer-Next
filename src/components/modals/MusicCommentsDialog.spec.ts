import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { useStatusStore } from "@/stores/status";
import MusicCommentsDialog from "./MusicCommentsDialog.vue";

const mockTrack = {
  id: "track-1",
  title: "测试曲目",
  source: "netease",
  duration: 200,
  artist: "测试歌手",
  artists: [{ id: "artist-1", name: "测试歌手" }],
};

const mockCommentData = {
  list: [
    {
      id: "comment-1",
      userName: "张三",
      text: "这是一条精彩的歌曲评论",
      time: 1700000000000,
      likedCount: 88,
      reply: [
        {
          id: "reply-1",
          userName: "李四",
          text: "赞同，前奏很抓耳",
          time: 1700001000000,
        },
      ],
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

describe("MusicCommentsDialog 评论复制功能", () => {
  let wrapper: VueWrapper;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
      writable: true,
    });

    window.api = {
      ...window.api,
      comments: {
        sources: vi.fn().mockResolvedValue([
          {
            id: "netease",
            name: "网易云音乐",
            kind: "builtin",
            platform: "netease",
            tabs: ["hot", "new"],
          },
        ]),
        get: vi.fn().mockResolvedValue({
          ok: true,
          data: mockCommentData,
        }),
      },
    } as any;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  /**
   * 挂载评论弹窗并等待首屏数据加载完成
   * @returns 包装后的测试组件实例
   */
  const mountDialog = async (): Promise<VueWrapper> => {
    const status = useStatusStore();
    status.commentsTrack = mockTrack as any;
    status.commentsOpen = false;

    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        "zh-CN": {
          common: {
            copied: "已复制",
            copyFailed: "复制失败",
            prev: "上一页",
            next: "下一页",
          },
          comments: {
            name: "歌曲评论",
            title: "「{name}」的评论",
            hot: "热门评论",
            new: "最新评论",
            copy: "复制",
            copyComment: "复制评论",
            copyReply: "复制回复",
            location: "来自{location}",
            page: "第 {page} / {total} 页",
          },
        },
      },
    });

    wrapper = mount(MusicCommentsDialog, {
      global: {
        plugins: [i18n],
        stubs: {
          SDialog: {
            props: ["open", "title"],
            template: '<div v-if="open" data-testid="dialog"><slot /></div>',
          },
          STabs: {
            props: ["modelValue", "tabs"],
            template: '<div data-testid="tabs" />',
          },
          SSelect: {
            props: ["modelValue", "options"],
            template: '<select data-testid="source-select" />',
          },
          SCard: {
            props: ["size", "radius"],
            template: '<div v-bind="$attrs" data-testid="comment-card"><slot /></div>',
          },
          SButton: {
            props: ["title", "disabled", "variant", "size", "circle", "loading"],
            template:
              '<button :title="title" :disabled="disabled" v-bind="$attrs"><slot name="icon" /><slot /></button>',
          },
          SImg: {
            props: ["src"],
            template: '<img :src="src" />',
          },
          SLoading: {
            template: "<div />",
          },
          SContextMenu: {
            props: ["items"],
            emits: ["select"],
            template: `
              <div data-testid="context-menu-wrapper">
                <slot />
                <div data-testid="context-menu-popover">
                  <button
                    v-for="item in items"
                    :key="item.key"
                    :data-testid="'menu-' + item.key"
                    @click="$emit('select', item.key)"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>
            `,
          },
          IconLucideThumbsUp: true,
          IconLucideCopy: true,
          IconLucideRefreshCw: true,
          IconLucideMessageCircleOff: true,
        },
      },
    });

    status.commentsOpen = true;
    await nextTick();
    await flushPromises();
    await nextTick();
    return wrapper;
  };

  it("评论正文与回复文本具备 select-text 类以支持用户文本选择", async () => {
    await mountDialog();

    const commentTextEl = wrapper.find("p.select-text");
    expect(commentTextEl.exists()).toBe(true);
    expect(commentTextEl.text()).toBe("这是一条精彩的歌曲评论");

    const replyContainer = wrapper.find("[data-reply-id='reply-1']");
    expect(replyContainer.exists()).toBe(true);
    const replySpans = replyContainer.findAll("span.select-text");
    expect(replySpans.length).toBe(2);
    expect(replySpans[0].text()).toContain("李四");
    expect(replySpans[1].text()).toBe("赞同，前奏很抓耳");
  });

  it("点击主评论复制按钮成功复制主评论文本且具备 aria-label", async () => {
    await mountDialog();

    const copyBtn = wrapper.find("button[title='复制评论']");
    expect(copyBtn.exists()).toBe(true);
    expect(copyBtn.attributes("aria-label")).toBe("复制评论");
    await copyBtn.trigger("click");

    expect(writeTextMock).toHaveBeenCalledWith("这是一条精彩的歌曲评论");
  });

  it("点击回复复制按钮成功复制回复文本且具备 aria-label", async () => {
    await mountDialog();

    const replyCopyBtn = wrapper.find("button[title='复制回复']");
    expect(replyCopyBtn.exists()).toBe(true);
    expect(replyCopyBtn.attributes("aria-label")).toBe("复制回复");
    await replyCopyBtn.trigger("click");

    expect(writeTextMock).toHaveBeenCalledWith("赞同，前奏很抓耳");
  });

  it("右键主评论触发上下文菜单提供复制评论选项并可执行复制", async () => {
    await mountDialog();

    const card = wrapper.find("[data-comment-id='comment-1']");
    expect(card.exists()).toBe(true);

    await card.trigger("contextmenu");
    await nextTick();

    const copyCommentMenuBtn = wrapper.find("[data-testid='menu-copyComment']");
    expect(copyCommentMenuBtn.exists()).toBe(true);
    expect(copyCommentMenuBtn.text()).toBe("复制评论");

    await copyCommentMenuBtn.trigger("click");
    expect(writeTextMock).toHaveBeenCalledWith("这是一条精彩的歌曲评论");
  });

  it("右键回复触发上下文菜单提供复制回复和复制主评论选项", async () => {
    await mountDialog();

    const replyEl = wrapper.find("[data-reply-id='reply-1']");
    expect(replyEl.exists()).toBe(true);

    await replyEl.trigger("contextmenu");
    await nextTick();

    const copyReplyMenuBtn = wrapper.find("[data-testid='menu-copyReply']");
    expect(copyReplyMenuBtn.exists()).toBe(true);
    expect(copyReplyMenuBtn.text()).toBe("复制回复");

    const copyCommentMenuBtn = wrapper.find("[data-testid='menu-copyComment']");
    expect(copyCommentMenuBtn.exists()).toBe(true);

    await copyReplyMenuBtn.trigger("click");
    expect(writeTextMock).toHaveBeenCalledWith("赞同，前奏很抓耳");
  });

  it("存在文本选区时右键优先展示复制选中文本并保留原样内容", async () => {
    await mountDialog();

    const originalGetSelection = window.getSelection;
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => "  精彩的歌曲片段  ",
    } as any);

    try {
      const card = wrapper.find("[data-comment-id='comment-1']");
      await card.trigger("contextmenu");
      await nextTick();

      const copySelectionBtn = wrapper.find("[data-testid='menu-copySelection']");
      expect(copySelectionBtn.exists()).toBe(true);
      expect(copySelectionBtn.text()).toBe("复制");

      await copySelectionBtn.trigger("click");
      expect(writeTextMock).toHaveBeenCalledWith("  精彩的歌曲片段  ");
    } finally {
      window.getSelection = originalGetSelection;
    }
  });

  it("纯空白文本选区不提供复制选区选项", async () => {
    await mountDialog();

    const originalGetSelection = window.getSelection;
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => "   \n\t  ",
    } as any);

    try {
      const card = wrapper.find("[data-comment-id='comment-1']");
      await card.trigger("contextmenu");
      await nextTick();

      expect(wrapper.find("[data-testid='menu-copySelection']").exists()).toBe(false);
      expect(wrapper.find("[data-testid='menu-copyComment']").exists()).toBe(true);
    } finally {
      window.getSelection = originalGetSelection;
    }
  });
});
