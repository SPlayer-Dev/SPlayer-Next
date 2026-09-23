import type { CollectionType } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useLibraryStore } from "@/stores/library";
import type { LoadCollectionOptions } from "./types";

export const loadLocalCollection = async (
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  const result =
    type === "playlist"
      ? await usePlaylistStore().get(id)
      : type === "album"
        ? await useLibraryStore().getAlbumCollection(decodeURIComponent(id))
        : null;
  if (!options.signal?.aborted) options.onUpdate(result);
};
