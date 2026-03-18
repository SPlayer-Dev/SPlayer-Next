import "./assets/main.css";
import "virtual:uno.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import { useStatusStore } from "./stores/status";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.use(pinia);

// 初始化播放器事件监听
useStatusStore().init();

app.mount("#app");
