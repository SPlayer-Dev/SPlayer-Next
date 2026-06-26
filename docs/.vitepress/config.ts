import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "SPlayer-Next",
  description: "一款简洁而精致的多平台桌面音乐播放器",
  lang: "zh-CN",
  ignoreDeadLinks: true,
  // 排除非站点内容（开发规划文档等）
  srcExclude: ["superpowers/**"],
  head: [
    ["link", { rel: "icon", href: "/favicon.png" }],
    ["meta", { name: "author", content: "imsyy" }],
    [
      "meta",
      {
        name: "keywords",
        content: "SPlayer,SPlayer-Next,音乐播放器,桌面歌词,流媒体,Electron,Vue3,Rust",
      },
    ],
  ],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: "/favicon.png",
    siteTitle: "SPlayer-Next",
    nav: [
      { text: "首页", link: "/" },
      { text: "下载", link: "/download" },
      { text: "使用指南", link: "/guide" },
      {
        text: "开发",
        items: [
          { text: "原生模块", link: "/native" },
          { text: "插件开发", link: "/plugins/" },
          { text: "外部 API", link: "/api" },
          { text: "贡献指南", link: "/contributing" },
        ],
      },
      { text: "GitHub", link: "https://github.com/SPlayer-Dev/SPlayer-Next" },
    ],

    sidebar: [
      {
        text: "指南",
        items: [
          { text: "下载", link: "/download" },
          { text: "使用指南", link: "/guide" },
          { text: "流媒体服务", link: "/streaming" },
          { text: "插件使用", link: "/plugins-usage" },
        ],
      },
      {
        text: "接口",
        items: [
          { text: "外部 API（HTTP）", link: "/api" },
          { text: "WebSocket API", link: "/socket" },
        ],
      },
      {
        text: "开发",
        items: [
          { text: "原生模块", link: "/native" },
          {
            text: "插件开发",
            items: [
              { text: "总览与架构", link: "/plugins/" },
              { text: "音源插件", link: "/plugins/source" },
              { text: "控制插件", link: "/plugins/control" },
            ],
          },
          { text: "贡献指南", link: "/contributing" },
        ],
      },
      {
        text: "故障排查",
        items: [
          { text: "调试模式与错误排查", link: "/troubleshooting/debug" },
          { text: "macOS 常见问题", link: "/troubleshooting/macos" },
          { text: "Mac 应用显示已损坏", link: "/troubleshooting/macos-damaged" },
          { text: "Windows 7 兼容性问题", link: "/troubleshooting/windows7" },
          { text: "Ubuntu 沙箱启动失败", link: "/troubleshooting/ubuntu-sandbox" },
          { text: "Linux Wayland 兼容性", link: "/troubleshooting/wayland" },
        ],
      },
    ],

    outline: {
      level: [2, 3],
      label: "文章目录",
    },

    socialLinks: [{ icon: "github", link: "https://github.com/SPlayer-Dev/SPlayer-Next" }],

    footer: {
      message: "基于 AGPL-3.0 许可发布",
      copyright: "Copyright © 2025-present imsyy",
    },

    editLink: {
      pattern: "https://github.com/SPlayer-Dev/SPlayer-Next/edit/dev/docs/:path",
      text: "查看或编辑此页",
    },

    lastUpdated: {
      text: "最后更新于",
      formatOptions: {
        dateStyle: "short",
        timeStyle: "medium",
      },
    },
  },
});
