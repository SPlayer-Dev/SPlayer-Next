import "virtual:uno.css";
import "@/styles/global.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";
import { useStatusStore } from "./stores/status";
import { useThemeStore } from "./stores/theme";
import { vRipple } from "./directives/ripple";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);

// 初始化主题
useThemeStore().init();
// 初始化播放器
useStatusStore().init();

app.mount("#app");
