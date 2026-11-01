import type { Collection } from "@/types/collection";

export interface LoadCollectionOptions {
  serverId?: string;
  fallbackName?: string;
  onUpdate: (collection: Collection | null) => void;
  signal?: AbortSignal;
}
