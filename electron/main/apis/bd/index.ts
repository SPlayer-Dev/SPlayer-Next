import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { request } from "undici";
import { getSessionCookies, saveSessionCookies } from "@main/database/sessions";
import { getProxyDispatcher } from "@main/utils/proxy";
import { createBdRequest } from "./core/request";
import type { BdContext, BdParams, BdResponse, BdSession } from "./core/types";
import { modules } from "./modules";

export const getBdSession = (): BdSession => {
  const session = getSessionCookies("bd");
  if (!session.devid) {
    session.devid = randomBytes(16).toString("hex");
    saveSessionCookies("bd", session);
  }
  return session;
};

export const mergeBdSession = (values: Record<string, string>): void => {
  const { devid } = getBdSession();
  saveSessionCookies("bd", { devid, uid: values.uid, token: values.token });
};

export const clearBdSession = (): void => {
  saveSessionCookies("bd", { devid: getBdSession().devid });
};

const context: BdContext = {
  getSession: getBdSession,
  saveSession: (session) => {
    saveSessionCookies("bd", { ...session, devid: getBdSession().devid });
  },
  request: createBdRequest(getBdSession, async (input): Promise<BdResponse> => {
    try {
      const response = await request(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        dispatcher: getProxyDispatcher(),
        signal: AbortSignal.timeout(15000),
      });
      if (response.statusCode !== 200) {
        await response.body.dump();
        throw new Error(`HTTP ${response.statusCode}`);
      }
      const bytes = Buffer.from(await response.body.arrayBuffer());
      const content = response.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes;
      return JSON.parse(content.toString("utf8")) as BdResponse;
    } catch {
      throw new Error("BD 网络请求失败，请检查网络或稍后重试");
    }
  }),
};

export const callBd = async <T = unknown>(name: string, params: BdParams = {}): Promise<T> => {
  const handler = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!handler) throw new Error(`unknown bd api: ${name}`);
  return (await handler(params, context)) as T;
};
