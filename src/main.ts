import "virtual:uno.css";
import "@/styles/global.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";

import { useThemeStore } from "./stores/theme";
import { initPlayer } from "./core/player";
import { vRipple } from "./directives/ripple";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);

// 初始化主题
useThemeStore().init();

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
