import type { TrackSource } from "@shared/types/player";
import type { CollectionType } from "@/types/collection";
import { loadLocalCollection } from "./local";
import { loadNeteaseCollection } from "./netease";
import { loadQQMusicCollection } from "./qqmusic";
import { loadKugouCollection } from "./kugou";
import { loadStreamingCollection } from "./streaming";
import type { LoadCollectionOptions } from "./types";

export type { LoadCollectionOptions } from "./types";

export const loadCollection = async (
  source: TrackSource,
  type: CollectionType,
  id: string,
  options: LoadCollectionOptions,
): Promise<void> => {
  if (source === "local") return loadLocalCollection(type, id, options);
  if (source === "streaming") return loadStreamingCollection(type, id, options);
  if (source === "netease") return loadNeteaseCollection(type, id, options);
  if (source === "qqmusic") return loadQQMusicCollection(type, id, options);
  if (source === "kugou") return loadKugouCollection(type, id, options);
  options.onUpdate(null);
};
