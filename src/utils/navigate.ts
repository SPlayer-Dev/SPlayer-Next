import router from "@/router";

/** 跳转到本地专辑页 */
export const navigateToAlbum = (albumName?: string) => {
  if (!albumName?.trim()) return;
  router.push({
    name: "collection",
    params: { source: "local", type: "album", id: encodeURIComponent(albumName) },
  });
};

/** 跳转到歌手页 */
export const navigateToArtist = (artistName?: string, source: "local" | "online" = "local") => {
  if (!artistName?.trim()) return;
  router.push({
    name: "artist",
    params: { source, id: encodeURIComponent(artistName) },
  });
};
