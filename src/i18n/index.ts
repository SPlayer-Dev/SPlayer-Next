import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

export type LocaleCode = "zh-CN" | "en-US";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
});

export default i18n;
