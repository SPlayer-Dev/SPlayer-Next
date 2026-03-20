import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: () => import("@/layouts/MainLayout.vue"),
      children: [
        {
          path: "",
          name: "home",
          component: () => import("@/pages/Home.vue"),
        },
      ],
    },
    {
      path: "/desktop-lyric",
      name: "desktop-lyric",
      component: () => import("@/pages/DesktopLyric.vue"),
    },
  ],
});

export default router;
