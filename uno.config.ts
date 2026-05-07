import { defineConfig, presetWind3, presetIcons } from "unocss";

export default defineConfig({
  presets: [presetWind3(), presetIcons()],
  shortcuts: {
    // 玻璃感面板
    "glass-panel": "bg-surface-panel/80 backdrop-blur-2xl backdrop-saturate-150",
    // 表单控件底色
    "bg-field": "bg-surface-bright/40",
  },
  theme: {
    fontFamily: {
      logo: "logo",
      sans: "var(--user-font, var(--app-font))",
    },
    animation: {
      keyframes: {
        "popover-in":
          "{ from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }",
        "popover-out":
          "{ from { opacity: 1; transform: translateY(0) } to { opacity: 0; transform: translateY(6px) } }",
        "overlay-in": "{ from { opacity: 0 } to { opacity: 1 } }",
        "overlay-out": "{ from { opacity: 1 } to { opacity: 0 } }",
        "dialog-in":
          "{ from { opacity: 0; transform: translate(-50%, -50%) scale(0.96) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }",
        "dialog-out":
          "{ from { opacity: 1; transform: translate(-50%, -50%) scale(1) } to { opacity: 0; transform: translate(-50%, -50%) scale(0.96) } }",
        "panel-in":
          "{ from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }",
        "panel-out":
          "{ from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(0.97) } }",
        "select-in":
          "{ from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }",
        "select-out":
          "{ from { opacity: 1; transform: translateY(0) } to { opacity: 0; transform: translateY(-4px) } }",
        "slide-in-item":
          "{ from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }",
        "fade-in": "{ from { opacity: 0 } to { opacity: 1 } }",
        "highlight-pulse":
          "{ 0%, 100% { box-shadow: 0 0 0 0 transparent } 25%, 75% { box-shadow: 0 0 0 3px rgb(var(--s-primary) / 0.3) } 50% { box-shadow: 0 0 0 3px rgb(var(--s-primary) / 0.15) } }",
        "drawer-in-right":
          "{ from { transform: translateX(100%) } to { transform: translateX(0) } }",
        "drawer-out-right":
          "{ from { transform: translateX(0) } to { transform: translateX(100%) } }",
        "drawer-in-left":
          "{ from { transform: translateX(-100%) } to { transform: translateX(0) } }",
        "drawer-out-left":
          "{ from { transform: translateX(0) } to { transform: translateX(-100%) } }",
      },
      durations: {
        "popover-in": "200ms",
        "popover-out": "150ms",
        "overlay-in": "200ms",
        "overlay-out": "150ms",
        "dialog-in": "200ms",
        "dialog-out": "150ms",
        "panel-in": "250ms",
        "panel-out": "150ms",
        "select-in": "150ms",
        "select-out": "100ms",
        "fade-in": "150ms",
        "slide-in-item": "250ms",
        "highlight-pulse": "2s",
        "drawer-in-right": "300ms",
        "drawer-out-right": "200ms",
        "drawer-in-left": "300ms",
        "drawer-out-left": "200ms",
      },
      timingFns: {
        "popover-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "popover-out": "ease-in",
        "overlay-in": "ease-out",
        "overlay-out": "ease-in",
        "dialog-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-out": "ease-in",
        "panel-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "panel-out": "ease-in",
        "select-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "select-out": "ease-in",
        "fade-in": "ease-out",
        "slide-in-item": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        "highlight-pulse": "ease-in-out",
        "drawer-in-right": "cubic-bezier(0.16, 1, 0.3, 1)",
        "drawer-out-right": "ease-in",
        "drawer-in-left": "cubic-bezier(0.16, 1, 0.3, 1)",
        "drawer-out-left": "ease-in",
      },
    },
    colors: {
      primary: "rgb(var(--s-primary) / <alpha-value>)",
      "primary-container": "rgb(var(--s-primary-container) / <alpha-value>)",
      "on-primary": "rgb(var(--s-on-primary) / <alpha-value>)",
      "on-primary-container": "rgb(var(--s-on-primary-container) / <alpha-value>)",
      secondary: "rgb(var(--s-secondary) / <alpha-value>)",
      "secondary-container": "rgb(var(--s-secondary-container) / <alpha-value>)",
      surface: "rgb(var(--s-surface) / <alpha-value>)",
      "surface-alt": "rgb(var(--s-surface-alt) / <alpha-value>)",
      "surface-panel": "rgb(var(--s-surface-panel) / <alpha-value>)",
      "surface-bright": "rgb(var(--s-surface-bright) / <alpha-value>)",
      "on-surface": "rgb(var(--s-on-surface) / <alpha-value>)",
      "on-surface-variant": "rgb(var(--s-on-surface-variant) / <alpha-value>)",
      outline: "rgb(var(--s-outline) / <alpha-value>)",
      "outline-variant": "rgb(var(--s-outline-variant) / <alpha-value>)",
      cover: "rgb(var(--s-cover) / <alpha-value>)",
    },
  },
});
