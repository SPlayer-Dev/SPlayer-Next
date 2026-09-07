import { createHash } from "node:crypto";
import type { BdRequest, BdRequestInput, BdRequestOptions, BdResponse, BdSession } from "./types";

export class BdApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(`BD ${code}: ${message}`);
    this.name = "BdApiError";
  }
}

export const encodeBdQuery = (params: BdRequestOptions["params"]): string => {
  const encode = (value: string): string =>
    encodeURIComponent(value)
      .replace(
        /[!\x27()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      )
      .replace(/%20/g, "+");
  return Object.entries(params ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encode(key)}=${encode(String(value))}`)
    .join("&");
};

export const signBdRequest = (
  path: string,
  params: BdRequestOptions["params"],
  body = "",
): string => {
  const queryCharacters = encodeBdQuery(params).match(/[a-zA-Z0-9]/g) ?? [];
  const bodySign = body ? createHash("md5").update(`${body}kuwotest`).digest("hex") : "";
  return createHash("md5")
    .update(`kuwotest${queryCharacters.sort().join("")}${bodySign}${path}`)
    .digest("hex");
};

export const buildBdRequest = (
  path: string,
  session: BdSession,
  options: BdRequestOptions = {},
): BdRequestInput => {
  const credentials = options.anonymous ? {} : session;
  const params: NonNullable<BdRequestOptions["params"]> = {
    uid: credentials.uid || "-1",
    token: credentials.token || "",
    ...options.params,
  };
  const body = options.data === undefined ? undefined : JSON.stringify(options.data);
  if (options.signed) {
    params.timestamp ??= Date.now();
    params.sign = signBdRequest(path, params, options.queryOnlySignature ? "" : body);
  }
  const headers: Record<string, string> = {
    "user-agent": "Dart/3.3 (dart:io)",
    plat: "win",
    "accept-encoding": "gzip",
    "api-ver": "application/json",
    channel: "W1",
    brand: "Windows 11 Pro for Workstations",
    net: "wifi",
    "content-type": "application/json",
    ver: "1.1.5",
    svrver: "13",
    devid: session.devid,
    qimei36: session.devid,
  };
  if (options.authHeaders) {
    headers.uid = String(params.uid);
    headers.token = String(params.token);
  }
  const baseUrl = "https://bd-api.kuwo.cn";
  return {
    url: `${baseUrl}${path}?${encodeBdQuery(params)}`,
    headers,
    method: options.method ?? "GET",
    body,
  };
};

export const createBdRequest =
  (
    getSession: () => BdSession,
    transport: (input: BdRequestInput) => Promise<BdResponse>,
  ): BdRequest =>
  async <T>(path: string, options?: BdRequestOptions): Promise<T> => {
    const response = await transport(buildBdRequest(path, getSession(), options));
    if (Number(response.code) !== 200) {
      throw new BdApiError(Number(response.code), response.msg || response.message || "请求失败");
    }
    return response.data as T;
  };
