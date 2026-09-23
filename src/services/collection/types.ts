import type { Collection } from "@/types/collection";

export interface LoadCollectionOptions {
  fallbackName?: string;
  onUpdate: (collection: Collection | null) => void;
  signal?: AbortSignal;
}
