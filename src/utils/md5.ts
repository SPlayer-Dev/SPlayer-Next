/**
 * MD5 实现（RFC 1321）
 *
 * 给 Subsonic 鉴权用：md5(password + salt) → hex 字符串。
 * Web Crypto 不支持 MD5，所以自己实现一个最小版本。
 */

const safeAdd = (x: number, y: number): number => {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
};

const rol = (n: number, c: number): number => (n << c) | (n >>> (32 - c));

const cmn = (q: number, a: number, b: number, x: number, s: number, t: number): number =>
  safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);

const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
  cmn((b & c) | (~b & d), a, b, x, s, t);
const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
  cmn((b & d) | (c & ~d), a, b, x, s, t);
const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
  cmn(b ^ c ^ d, a, b, x, s, t);
const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number): number =>
  cmn(c ^ (b | ~d), a, b, x, s, t);

const md5cycle = (x: number[], k: number[]): void => {
  let [a, b, c, d] = x;

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259);
  b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = safeAdd(x[0], a);
  x[1] = safeAdd(x[1], b);
  x[2] = safeAdd(x[2], c);
  x[3] = safeAdd(x[3], d);
};

const md51 = (s: string): number[] => {
  const bytes = new TextEncoder().encode(s);
  const n = bytes.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i: number;
  for (i = 64; i <= n; i += 64) {
    md5cycle(state, md5blk(bytes.subarray(i - 64, i)));
  }
  const tail = new Array<number>(16).fill(0);
  const tailBytes = bytes.subarray(i - 64);
  let j: number;
  for (j = 0; j < tailBytes.length; j++) {
    tail[j >> 2] |= tailBytes[j] << ((j & 3) << 3);
  }
  tail[j >> 2] |= 0x80 << ((j & 3) << 3);
  if (j > 55) {
    md5cycle(state, tail);
    for (let k = 0; k < 16; k++) tail[k] = 0;
  }
  // 长度（bits）
  const lenBits = n * 8;
  tail[14] = lenBits >>> 0;
  tail[15] = Math.floor(lenBits / 0x100000000);
  md5cycle(state, tail);
  return state;
};

const md5blk = (chunk: Uint8Array): number[] => {
  const blk = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    blk[i] =
      chunk[i * 4] | (chunk[i * 4 + 1] << 8) | (chunk[i * 4 + 2] << 16) | (chunk[i * 4 + 3] << 24);
  }
  return blk;
};

const HEX = "0123456789abcdef";

const rhex = (n: number): string => {
  let s = "";
  for (let j = 0; j < 4; j++) {
    s += HEX[(n >> (j * 8 + 4)) & 0x0f] + HEX[(n >> (j * 8)) & 0x0f];
  }
  return s;
};

/** MD5(s) → 32 字符小写 hex 字符串 */
export const md5 = (s: string): string => md51(s).map(rhex).join("");
