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
import { initPlayer } from "./core/player";
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

// 同步语言设置：store（持久化） ↔ vue-i18n（运行时）
const settingsStore = useSettingsStore();
i18n.global.locale.value = settingsStore.locale;
watch(
  () => settingsStore.locale,
  (v) => {
    i18n.global.locale.value = v;
  },
);

// 初始化程序
Promise.all([initPlayer().catch(console.error), router.isReady()]).then(() => {
  app.mount("#app");
  // 淡出加载动画
  const loading = document.getElementById("app-loading");
  if (loading) {
    loading.classList.add("hidden");
    loading.addEventListener("transitionend", () => loading.remove());
  }
});
