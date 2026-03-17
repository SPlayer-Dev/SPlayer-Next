import "./assets/main.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import { useStatusStore } from "./stores/status";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.use(pinia);

// pinia 就绪后初始化播放器事件监听，全生命周期只跑一次
useStatusStore().init();

app.mount("#app");
