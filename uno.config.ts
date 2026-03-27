import { defineConfig, presetWind3, presetIcons } from "unocss";

export default defineConfig({
  presets: [presetWind3(), presetIcons()],
  theme: {
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
      },
      durations: {
        "popover-in": "150ms",
        "popover-out": "100ms",
        "overlay-in": "200ms",
        "overlay-out": "150ms",
        "dialog-in": "200ms",
        "dialog-out": "150ms",
      },
      timingFns: {
        "popover-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "popover-out": "ease-in",
        "overlay-in": "ease-out",
        "overlay-out": "ease-in",
        "dialog-in": "cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-out": "ease-in",
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
