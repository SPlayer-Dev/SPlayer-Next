/**
 * Netease API 模块函数签名
 * 每个 module 都是 `(query, request) => Promise<RequestResponse>`
 */

import type { createRequest } from "./request";
import type { RequestResponse } from "./response";
import type { Query } from "./option";

export type RequestFn = typeof createRequest;

export type NeteaseModule = (query: Query, request: RequestFn) => Promise<RequestResponse>;
