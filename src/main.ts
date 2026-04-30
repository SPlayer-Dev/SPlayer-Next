import "virtual:uno.css";
import "@/styles/global.css";

import { createApp, watch } from "vue";
import { createPinia } from "pinia";
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

// 初始化程序
router.isReady().then(async () => {
  // 初始化快捷键
  await useHotkeyStore().init();
  installHotkeyManager();
  // 挂载应用
  app.mount("#app");
  const loading = document.getElementById("app-loading");
  if (loading) {
    loading.classList.add("hidden");
    loading.addEventListener("transitionend", () => loading.remove(), { once: true });
  }
  initPlayer().catch(console.error);
});
