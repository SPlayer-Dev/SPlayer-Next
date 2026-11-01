export type KGParams = Record<string, unknown>;

export type KGModule = (params: KGParams) => Promise<unknown>;
