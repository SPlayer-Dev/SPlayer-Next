import { defineConfig, presetUno, presetIcons } from "unocss";

export default defineConfig({
  presets: [presetUno(), presetIcons()],
  theme: {
    colors: {
      primary: "rgb(var(--s-primary) / <alpha-value>)",
      "primary-container": "rgb(var(--s-primary-container) / <alpha-value>)",
      "on-primary": "rgb(var(--s-on-primary) / <alpha-value>)",
      "on-primary-container": "rgb(var(--s-on-primary-container) / <alpha-value>)",
      secondary: "rgb(var(--s-secondary) / <alpha-value>)",
      "secondary-container": "rgb(var(--s-secondary-container) / <alpha-value>)",
      surface: "rgb(var(--s-surface) / <alpha-value>)",
      "surface-alt": "rgb(var(--s-surface-alt) / <alpha-value>)",
      "on-surface": "rgb(var(--s-on-surface) / <alpha-value>)",
      "on-surface-variant": "rgb(var(--s-on-surface-variant) / <alpha-value>)",
      outline: "rgb(var(--s-outline) / <alpha-value>)",
      "outline-variant": "rgb(var(--s-outline-variant) / <alpha-value>)",
      error: "rgb(var(--s-error) / <alpha-value>)",
      cover: "rgb(var(--s-cover) / <alpha-value>)",
    },
  },
  // 主题切换过渡动画
  preflights: [
    {
      getCSS: () => `
        .theme-transition,
        .theme-transition *,
        .theme-transition *::before,
        .theme-transition *::after {
          transition: background-color 0.3s, color 0.3s, border-color 0.3s !important;
        }
      `,
    },
  ],
});
