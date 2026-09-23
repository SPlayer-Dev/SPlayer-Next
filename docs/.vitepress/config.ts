import { defineConfig, type DefaultTheme } from "vitepress";

const socialLinks: DefaultTheme.SocialLink[] = [
  { icon: "github", link: "https://github.com/SPlayer-Dev/SPlayer-Next" },
];

const zhTheme: DefaultTheme.Config = {
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
        { text: "MCP 接口", link: "/mcp" },
        { text: "贡献指南", link: "/contributing" },
      ],
    },
    { text: "类型参考", link: "/types" },
    {
      text: "关于",
      items: [
        { text: "用户协议", link: "/agreement" },
        { text: "隐私策略", link: "/privacy" },
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
        { text: "用户协议", link: "/agreement" },
        { text: "隐私策略", link: "/privacy" },
      ],
    },
    {
      text: "接口",
      items: [
        { text: "外部 API（HTTP）", link: "/api" },
        { text: "WebSocket API", link: "/socket" },
        { text: "MCP 接口", link: "/mcp" },
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
            { text: "插件更新", link: "/plugins/update" },
          ],
        },
        { text: "类型参考", link: "/types" },
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
  outline: { level: [2, 3], label: "文章目录" },
  footer: {
    message:
      '基于 AGPL-3.0 许可发布 | <a href="/agreement">用户协议</a> | <a href="/privacy">隐私策略</a>',
    copyright: "Copyright © 2025-present imsyy",
  },
  editLink: {
    pattern: "https://github.com/SPlayer-Dev/SPlayer-Next/blob/dev/docs/:path?plain=1",
    text: "查看或编辑此页",
  },
  lastUpdated: {
    text: "最后更新于",
    formatOptions: { dateStyle: "short", timeStyle: "medium" },
  },
};

const enTheme: DefaultTheme.Config = {
  nav: [
    { text: "Home", link: "/en/" },
    { text: "Download", link: "/en/download" },
    { text: "User Guide", link: "/en/guide" },
    {
      text: "Development",
      items: [
        { text: "Native Modules", link: "/en/native" },
        { text: "Plugin Development", link: "/en/plugins/" },
        { text: "External API", link: "/en/api" },
        { text: "MCP", link: "/en/mcp" },
        { text: "Contributing", link: "/en/contributing" },
      ],
    },
    { text: "Type Reference", link: "/en/types" },
    {
      text: "About",
      items: [
        { text: "User Agreement", link: "/en/agreement" },
        { text: "Privacy Policy", link: "/en/privacy" },
      ],
    },
    { text: "GitHub", link: "https://github.com/SPlayer-Dev/SPlayer-Next" },
  ],
  sidebar: [
    {
      text: "Guides",
      items: [
        { text: "Download", link: "/en/download" },
        { text: "User Guide", link: "/en/guide" },
        { text: "Streaming Services", link: "/en/streaming" },
        { text: "Using Plugins", link: "/en/plugins-usage" },
        { text: "User Agreement", link: "/en/agreement" },
        { text: "Privacy Policy", link: "/en/privacy" },
      ],
    },
    {
      text: "Interfaces",
      items: [
        { text: "External API (HTTP)", link: "/en/api" },
        { text: "WebSocket API", link: "/en/socket" },
        { text: "MCP", link: "/en/mcp" },
      ],
    },
    {
      text: "Development",
      items: [
        { text: "Native Modules", link: "/en/native" },
        {
          text: "Plugin Development",
          items: [
            { text: "Overview and Architecture", link: "/en/plugins/" },
            { text: "Source Plugins", link: "/en/plugins/source" },
            { text: "Control Plugins", link: "/en/plugins/control" },
            { text: "Plugin Updates", link: "/en/plugins/update" },
          ],
        },
        { text: "Type Reference", link: "/en/types" },
        { text: "Contributing", link: "/en/contributing" },
      ],
    },
    {
      text: "Troubleshooting",
      items: [
        { text: "Debug Mode and Errors", link: "/en/troubleshooting/debug" },
        { text: "Common macOS Issues", link: "/en/troubleshooting/macos" },
        { text: "macOS Reports a Damaged App", link: "/en/troubleshooting/macos-damaged" },
        { text: "Windows 7 Compatibility", link: "/en/troubleshooting/windows7" },
        { text: "Ubuntu Sandbox Startup Failure", link: "/en/troubleshooting/ubuntu-sandbox" },
        { text: "Linux Wayland Compatibility", link: "/en/troubleshooting/wayland" },
      ],
    },
  ],
  outline: { level: [2, 3], label: "On this page" },
  footer: {
    message:
      'Released under AGPL-3.0 | <a href="/en/agreement">User Agreement</a> | <a href="/en/privacy">Privacy Policy</a>',
    copyright: "Copyright © 2025-present imsyy",
  },
  editLink: {
    pattern: "https://github.com/SPlayer-Dev/SPlayer-Next/blob/dev/docs/:path?plain=1",
    text: "View or edit this page",
  },
  lastUpdated: {
    text: "Last updated",
    formatOptions: { dateStyle: "medium", timeStyle: "short" },
  },
};

export default defineConfig({
  title: "SPlayer-Next",
  srcExclude: ["superpowers/**"],
  head: [
    ["link", { rel: "icon", href: "/favicon.png" }],
    ["meta", { name: "author", content: "imsyy" }],
    [
      "meta",
      {
        name: "keywords",
        content: "SPlayer,SPlayer-Next,music player,desktop lyrics,streaming,Electron,Vue3,Rust",
      },
    ],
  ],
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      description: "一款简洁而精致的多平台桌面音乐播放器",
      themeConfig: zhTheme,
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      description: "A clean and refined cross-platform desktop music player",
      themeConfig: enTheme,
    },
  },
  themeConfig: {
    logo: "/favicon.png",
    siteTitle: "SPlayer-Next",
    socialLinks,
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "清除查询条件",
                backButtonTitle: "关闭搜索",
                noResultsText: "没有找到相关结果",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },
  },
});
