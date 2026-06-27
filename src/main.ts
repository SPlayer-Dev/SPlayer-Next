import "virtual:uno.css";
import "@/styles/global.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";
import i18n from "./i18n";

import { useThemeStore } from "./stores/theme";
import { useSettingsStore } from "./stores/settings";
import { useHotkeyStore } from "./stores/hotkey";
import { initPlayer } from "./core/player";
import { installHotkeyManager } from "./core/hotkey/manager";
import { vRipple } from "./directives/ripple";

const bootStart = performance.now();
const logBoot = (stage: string): void => {
  console.info(`[boot] ${stage} ${Math.round(performance.now() - bootStart)}ms`);
};

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);
app.use(i18n);

// 初始化主题
useThemeStore().init();

// 同步语言设置
watch(
  () => useSettingsStore().locale,
  (v) => {
    i18n.global.locale.value = v;
    window.api.system.setLocale(v);
  },
  { immediate: true },
);

/** 笔画动画结束 */
const SPLASH_ANIM_MS = 2050;

// 初始化程序
router.isReady().then(() => {
  logBoot("router ready");
  // 挂载应用
  app.mount("#app");
  logBoot("app mounted");
  // 笔画播完即淡出
  const remaining = Math.max(0, SPLASH_ANIM_MS - performance.now());
  setTimeout(() => {
    const loading = document.getElementById("app-loading");
    if (loading) {
      loading.classList.add("hidden");
      loading.addEventListener("transitionend", () => loading.remove(), { once: true });
    }
    logBoot("splash hidden");
  }, remaining);
  // 初始化播放器
  initPlayer()
    .then(() => logBoot("player ready"))
    .catch(console.error);
  // 初始化快捷键
  useHotkeyStore()
    .init()
    .then(installHotkeyManager)
    .catch((err) => console.error("[hotkey] init failed", err));
});
