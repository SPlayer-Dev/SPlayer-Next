import { randomBytes, randomUUID as cryptoRandomUUID } from "node:crypto";
import * as zlib from "node:zlib";
import { CLIENT_LOG3_DOMAIN } from "./config";
import { fetchWithProxy } from "@main/utils/proxy";

interface NeteaseLogRecord {
  time: number;
  action: string;
  data: unknown;
}

interface NcblContext {
  app: {
    id: string;
    urs: string;
    pid: string;
    nsm: string;
    cid: string;
    channel: string;
    version: string;
    versionCode: string;
    buildCode: string;
    buildType: string;
    packageId: string;
  };
  device: {
    id: string;
    ti: string;
    sign: string;
    model: string;
    nnid: string;
    nuid: string;
    csrf: string;
    systemType: string;
    systemVersion: string;
  };
  auth: {
    token: string;
    sessionId: string;
    vipType: string;
  };
  startTime: number;
  processId: number;
}

interface NcblSong {
  id: number;
  name: string;
  artist: string;
  bitrate: number;
  level: string;
  vip: boolean;
  time: number;
}

interface NcblSource {
  id: string;
  type: string;
  name: string;
}

interface UploadResult {
  success: boolean;
  fileName: string;
  payload: Buffer;
  respBody: Record<string, any>;
}

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const RSA_N = 0xfd90bd466ff9bc8a3fec2fbcf263b90d5c564879fa5d7aab89b31c1d5cb4139dn;
const RSA_E = 65537n;
const MAGIC = Buffer.from("NCBL", "ascii");
const NCBL_VERSION = 3;
const HEADER_FIXED_LEN = 70;
const META_BLOCK_TYPE = 0x4343;
const DEFAULT_MAX_FRAME = 0x8000;
const FIELD_SEP = "\x01";

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

const quarterRound = (s: Uint32Array, a: number, b: number, c: number, d: number): void => {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] ^= s[a];
  s[d] = rotl(s[d], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] ^= s[c];
  s[b] = rotl(s[b], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] ^= s[a];
  s[d] = rotl(s[d], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] ^= s[c];
  s[b] = rotl(s[b], 7);
};

const chachaBlock = (key: Buffer, counter: number, nonce: Buffer): Buffer => {
  const state = new Uint32Array(16);
  state[0] = SIGMA[0];
  state[1] = SIGMA[1];
  state[2] = SIGMA[2];
  state[3] = SIGMA[3];
  for (let i = 0; i < 8; i++) state[4 + i] = key.readUInt32LE(i * 4);
  state[12] = counter >>> 0;
  state[13] = nonce.readUInt32LE(0);
  state[14] = nonce.readUInt32LE(4);
  state[15] = nonce.readUInt32LE(8);

  const work = state.slice();
  for (let i = 0; i < 10; i++) {
    quarterRound(work, 0, 4, 8, 12);
    quarterRound(work, 1, 5, 9, 13);
    quarterRound(work, 2, 6, 10, 14);
    quarterRound(work, 3, 7, 11, 15);
    quarterRound(work, 0, 5, 10, 15);
    quarterRound(work, 1, 6, 11, 12);
    quarterRound(work, 2, 7, 8, 13);
    quarterRound(work, 3, 4, 9, 14);
  }

  const out = Buffer.allocUnsafe(64);
  for (let i = 0; i < 16; i++) out.writeUInt32LE((work[i] + state[i]) >>> 0, i * 4);
  return out;
};

const chacha20 = (key: Buffer, counter: number, nonce: Buffer, data: Buffer): Buffer => {
  const out = Buffer.allocUnsafe(data.length);
  for (let off = 0; off < data.length; off += 64) {
    const ks = chachaBlock(key, (counter + (off >>> 6)) >>> 0, nonce);
    const end = Math.min(off + 64, data.length);
    for (let i = off; i < end; i++) out[i] = data[i] ^ ks[i - off];
  }
  return out;
};

const beToBig = (buf: Buffer): bigint => {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
};

const bigToBe = (n: bigint, len: number): Buffer => {
  const out = Buffer.alloc(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
};

const modPow = (base: bigint, exp: bigint, mod: bigint): bigint => {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
};

export const rsaWrap = (keyA: Buffer): Buffer => bigToBe(modPow(beToBig(keyA), RSA_E, RSA_N), 32);

const compressBody = (buf: Buffer): Buffer => {
  const zstd = (zlib as unknown as { zstdCompressSync?: (input: Buffer) => Buffer })
    .zstdCompressSync;
  // NCBL v3 头不带压缩标识,服务端固定按 zstd 解;缺 zstd 时直接报错,不能塞 gzip 让服务端解不开
  if (!zstd) throw new Error("当前运行时不支持 zstd,无法进行 NCBL 上报");
  return zstd(buf);
};

export const encryptNCBL = (meta: string | Buffer, body: string | Buffer): Buffer => {
  const metaBuf = Buffer.isBuffer(meta) ? meta : Buffer.from(meta, "utf-8");
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf-8");
  const keyA = randomBytes(32);
  if (keyA[0] >= 0xa3) keyA[0] = 0xa2;
  const keyB = rsaWrap(keyA);
  const uuid = randomBytes(16);
  uuid[6] = (uuid[6] & 0x0f) | 0x40;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const nonce = uuid.subarray(0, 12);
  const counter = uuid.readUInt32LE(12) >>> 2;
  const baseSeq = randomBytes(2).readUInt16LE(0);

  const metaCipher = chacha20(keyB, counter, nonce, metaBuf);
  const metaHead = Buffer.allocUnsafe(4);
  metaHead.writeUInt16LE(META_BLOCK_TYPE, 0);
  metaHead.writeUInt16LE(metaCipher.length, 2);
  const metaBlock = Buffer.concat([metaHead, metaCipher]);
  const headerLen = HEADER_FIXED_LEN + metaBlock.length;
  const compressed = compressBody(bodyBuf);

  const frames: Buffer[] = [];
  let seq = baseSeq;
  for (let off = 0; off < compressed.length || off === 0; off += DEFAULT_MAX_FRAME) {
    const slice = compressed.subarray(off, off + DEFAULT_MAX_FRAME);
    const cipher = chacha20(keyA, counter, nonce, slice);
    const head = Buffer.allocUnsafe(6);
    head.writeUInt16LE(cipher.length, 0);
    head.writeUInt32LE(seq >>> 0, 2);
    frames.push(head, cipher);
    seq++;
    if (compressed.length === 0) break;
  }

  const trailing = Buffer.concat(frames);
  const frameCount = seq - baseSeq;
  const header = Buffer.alloc(HEADER_FIXED_LEN);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(NCBL_VERSION, 4);
  header.writeUInt16LE(headerLen, 8);
  uuid.copy(header, 10);
  keyB.copy(header, 26);
  header.writeUInt32LE(baseSeq >>> 0, 58);
  header.writeUInt32LE((baseSeq + frameCount - 1) >>> 0, 62);
  header.writeUInt32LE(trailing.length, 66);
  return Buffer.concat([header, metaBlock, trailing]);
};

const buildRecord = ({ time, action, data }: NeteaseLogRecord): string => {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return [time, action, json].join(FIELD_SEP);
};

export const buildRecords = (records: NeteaseLogRecord[]): string =>
  records.map(buildRecord).join("");

export const buildPlv = (
  ctx: NcblContext,
  song: NcblSong,
  source: NcblSource,
): Record<string, unknown> => {
  const now = Date.now();
  return {
    mode: "circulation",
    download: 0,
    alg: "",
    status: "front",
    id: String(song.id),
    bitrate: song.bitrate,
    type: "song",
    is_listentogether: 0,
    source: source.name,
    is_heart: 0,
    resource_ratio: "",
    resource_time: song.time,
    musiceffect_id: "",
    app_mode: 2,
    bitrate_level: song.level,
    _addrefer: `[F:63][${now}#933#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][23][cell_pc_songlist_song:2|page_pc_songlist_songflow|page_mine_like_music][${song.id}:song:x:x|:::|${source.id}:list::]`,
    _multirefers: [
      "[F:26][s][18][_ai]",
      "[F:26][s][12][_ai]",
      `[F:63][${now}#933#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][8][cell_pc_main_tab_entrance:6|page_pc_main_tab][我喜欢的音乐:spm::|:::]`,
      "[F:26][s][5][_ai]",
      "[F:26][s][0][_ai]",
    ],
    vipType: ctx.auth.vipType,
    fee: 1,
    file: 4,
    rightSource: 0,
    sourceId: source.id,
    sourcetype: source.type,
    libra_abt: "",
    channel: ctx.app.channel,
    curStartChannel: "",
  };
};

export const buildPld = (
  ctx: NcblContext,
  song: NcblSong,
  source: NcblSource,
  played: number,
): Record<string, unknown> => {
  const now = Date.now();
  return {
    mode: "circulation",
    download: 0,
    alg: "",
    status: "front",
    id: String(song.id),
    time: played,
    type: "song",
    is_listentogether: 0,
    source: source.name,
    is_heart: 0,
    realtime: played,
    resource_ratio: "",
    resource_time: song.time,
    musiceffect_id: "1001",
    app_mode: 1,
    lyriceffect: "default",
    displayMode: "classic",
    bitrate: song.bitrate,
    bitrate_level: song.level,
    _addrefer: `[F:63][${now}#616#${ctx.app.version}#${ctx.app.versionCode}#c9156c3][e][2][92][btn_pc_cover_play|cell_pc_songlist_song:6|page_pc_songlist_songflow|page_mine_like_music][:::|${song.id}:song:x:x|:::|${source.id}:list::]`,
    _multirefers: [
      "[F:26][s][87][_ai]",
      "[F:26][s][81][_ai]",
      "[F:26][s][75][_ai]",
      "[F:26][s][69][_ai]",
      "[F:26][s][63][_ai]",
    ],
    vipType: ctx.auth.vipType,
    fee: 8,
    file: 4,
    rightSource: 0,
    sourceId: source.id,
    sourcetype: source.type,
    end: "interrupt",
    libra_abt: "",
    channel: ctx.app.channel,
    curStartChannel: "",
  };
};

export const parseCookie = (cookie: unknown): Record<string, string> => {
  if (cookie && typeof cookie === "object") return cookie as Record<string, string>;
  if (typeof cookie !== "string") return {};
  const obj: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.substring(0, idx).trim();
    const val = part.substring(idx + 1).trim();
    if (key) obj[key] = val;
  }
  return obj;
};

export const extractContext = (cookieObj: Record<string, string>): NcblContext => ({
  app: {
    id: cookieObj.appid || "",
    urs: "",
    pid: "",
    nsm: cookieObj.WEVNSM || "1.0.0",
    cid: cookieObj.WNMCID || `${randomBytes(3).toString("hex")}.${Date.now()}.01.0`,
    channel: cookieObj.channel || "netease",
    version: cookieObj.appver || "3.1.35",
    versionCode: cookieObj.versioncode || "205293",
    buildCode: cookieObj.buildver || "",
    buildType: "release",
    packageId: "",
  },
  device: {
    id: cookieObj.deviceId || cookieObj.sDeviceId || "",
    ti: cookieObj.NMTID || "",
    sign: cookieObj.clientSign || "",
    model: cookieObj.mode || cookieObj.mobilename || "",
    nnid: cookieObj._ntes_nnid || ",",
    nuid: cookieObj._ntes_nuid || "",
    csrf: cookieObj.__csrf || "",
    systemType: cookieObj.os || "pc",
    systemVersion: cookieObj.osver || "Microsoft-Windows-10-Professional-build-19045-64bit",
  },
  auth: {
    token: cookieObj.MUSIC_U || "",
    sessionId: cookieObj["JSESSIONID-WYYY"] || "",
    vipType: cookieObj.vipType || "",
  },
  startTime: Date.now(),
  processId: Math.floor(Math.random() * 90000) + 10000,
});

const randomHexId = (): string => cryptoRandomUUID().replace(/-/g, "");

export const buildMultipart = (
  payload: Buffer,
): { boundary: string; fileName: string; body: Buffer } => {
  const boundary = randomHexId();
  const fileName = `op_${Math.floor(Math.random() * 90000) + 10000}_0_${
    Math.floor(Math.random() * 4294967295) + 1
  }`;
  const crlf = "\r\n";
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    "Content-Type: multipart/form-data",
    "",
    "",
  ].join(crlf);
  const footer = `${crlf}--${boundary}--${crlf}`;
  return {
    boundary,
    fileName,
    body: Buffer.concat([Buffer.from(header, "utf-8"), payload, Buffer.from(footer, "utf-8")]),
  };
};

export const buildCookieStr = (ctx: NcblContext): string =>
  [
    `JSESSIONID-WYYY=${ctx.auth.sessionId}`,
    `MUSIC_U=${ctx.auth.token}`,
    `NMTID=${ctx.device.ti}`,
    `WEVNSM=${ctx.app.nsm}`,
    `WNMCID=${ctx.app.cid}`,
    `__csrf=${ctx.device.csrf}`,
    "__remember_me=true",
    "_iuqxldmzr_=33",
    `_ntes_nnid=${ctx.device.nnid}`,
    `_ntes_nuid=${ctx.device.nuid}`,
    `appver=${ctx.app.version}.${ctx.app.versionCode}`,
    `channel=${ctx.app.channel}`,
    `clientSign=${ctx.device.sign}`,
    `deviceId=${ctx.device.id}`,
    `mode=${ctx.device.model}`,
    "ntes_kaola_ad=1",
    `os=${ctx.device.systemType}`,
    `osver=${ctx.device.systemVersion}`,
  ].join("; ");

export const buildMetaJson = (ctx: NcblContext): string =>
  JSON.stringify({
    "JSESSIONID-WYYY": ctx.auth.sessionId,
    MUSIC_U: ctx.auth.token,
    NMTID: ctx.device.ti,
    WEVNSM: ctx.app.nsm,
    WNMCID: ctx.app.cid,
    __csrf: ctx.device.csrf,
    _iuqxldmzr_: "33",
    _ntes_nnid: ctx.device.nnid,
    _ntes_nuid: ctx.device.nuid,
    appver: `${ctx.app.version}.${ctx.app.versionCode}`,
    channel: ctx.app.channel,
    clientSign: ctx.device.sign,
    deviceId: ctx.device.id,
    mode: ctx.device.model,
    ntes_kaola_ad: "1",
    os: ctx.device.systemType,
    osver: ctx.device.systemVersion,
  });

export const doUpload = async (
  ctx: NcblContext,
  metaJson: string,
  body: string,
  cookieStr: string,
): Promise<UploadResult> => {
  const payload = encryptNCBL(metaJson, body);
  const multipart = buildMultipart(payload);
  const resp = await fetchWithProxy(
    `${CLIENT_LOG3_DOMAIN}/api/clientlog/encrypt/upload?multiupload=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
        Referer: "https://music.163.com/di",
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/${ctx.app.version}`,
        "Accept-Encoding": "gzip,deflate",
        "Accept-Language": "zh-CN,zh;q=0.8",
        Cookie: cookieStr,
      },
      body: new Uint8Array(multipart.body),
      signal: AbortSignal.timeout(15000),
    },
  );

  const text = await resp.text();
  let respBody: Record<string, any>;
  try {
    respBody = JSON.parse(text) as Record<string, any>;
  } catch {
    respBody = { code: resp.status, raw: text };
  }
  const success =
    respBody?.code === 200 && respBody?.data?.successfiles?.includes?.(multipart.fileName);
  return { success, fileName: multipart.fileName, payload, respBody };
};
