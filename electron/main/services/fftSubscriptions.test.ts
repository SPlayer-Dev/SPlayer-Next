import assert from "node:assert/strict";
import { test } from "node:test";
import { FftSubscriptions, encodeSpectrum } from "./fftSubscriptions";

test("远程和本机 FFT 需求互不覆盖，释放与暂停停止远程采样", () => {
  const states: boolean[] = [];
  const hub = new FftSubscriptions((enabled) => states.push(enabled));
  let frames = 0;
  const off = hub.subscribe(() => frames++);
  assert.equal(hub.enabled, false);
  hub.setPlaying(true);
  assert.equal(hub.enabled, true);
  hub.setRenderer(true);
  hub.setRenderer(false);
  assert.equal(hub.enabled, true);
  hub.publish({ ldata: [], rdata: [] });
  assert.equal(frames, 1);
  hub.setPlaying(false);
  hub.publish({ ldata: [], rdata: [] });
  assert.equal(frames, 1);
  assert.equal(hub.enabled, false);
  hub.setRenderer(true);
  off();
  assert.equal(hub.enabled, true);
  hub.setRenderer(false);
  assert.equal(states.at(-1), false);
  const count = states.length;
  off();
  assert.equal(states.length, count);
});

test("多个显示连接分别释放，最后一个退出才关闭 FFT", () => {
  const hub = new FftSubscriptions(() => {});
  hub.setPlaying(true);
  const a = hub.subscribe(() => {});
  const b = hub.subscribe(() => {});
  a();
  assert.equal(hub.enabled, true);
  b();
  assert.equal(hub.enabled, false);
});

test("132 字节协议保留标识、声道顺序和中央低频，并限制量化范围", () => {
  const left = Array(128).fill(0);
  const right = Array(128).fill(0);
  left[8] = 1;
  right[8] = 0.5;
  left[126] = left[127] = 2;
  right[126] = right[127] = -1;
  const packet = encodeSpectrum({ ldata: left, rdata: right });
  assert.equal(packet.length, 132);
  assert.equal(Buffer.from(packet.subarray(0, 4)).toString(), "SPF1");
  assert.equal(packet[4], 255);
  assert.equal(packet[67], 255);
  assert.equal(packet[68], 128);
  assert.equal(packet[131], 0);
  assert.equal(encodeSpectrum({ ldata: [], rdata: [] }).subarray(4).some(Boolean), false);
});
