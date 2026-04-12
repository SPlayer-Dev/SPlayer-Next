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
        {
          path: "library",
          name: "library",
          component: () => import("@/pages/Library.vue"),
        },
        {
          path: "collection/:source/:type/:id",
          name: "collection",
          component: () => import("@/pages/Collection.vue"),
        },
        {
          path: "artist/:source/:id",
          name: "artist",
          component: () => import("@/pages/Artist.vue"),
        },
        {
          path: "artists/local",
          name: "artist-list",
          component: () => import("@/pages/ArtistList.vue"),
        },
        {
          path: "albums/local",
          name: "album-list",
          component: () => import("@/pages/AlbumList.vue"),
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
