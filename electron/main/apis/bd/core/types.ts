export type BdSession = Record<string, string>;
export type BdParams = Record<string, unknown>;

export interface BdRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  data?: Record<string, unknown>;
  method?: "GET" | "POST";
  anonymous?: boolean;
  signed?: boolean;
  queryOnlySignature?: boolean;
  authHeaders?: boolean;
}

export interface BdRequestInput {
  url: string;
  headers: Record<string, string>;
  method: "GET" | "POST";
  body?: string;
}

export interface BdResponse {
  code: number;
  msg?: string;
  message?: string;
  data?: unknown;
}

export type BdRequest = <T>(path: string, options?: BdRequestOptions) => Promise<T>;

export interface BdContext {
  request: BdRequest;
  getSession: () => BdSession;
  saveSession: (session: BdSession) => void;
}

export type BdModule = (params: BdParams, context: BdContext) => Promise<unknown>;
