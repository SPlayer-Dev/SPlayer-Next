import { randomUUID } from "node:crypto";
import { getKgAppid, getKgClientver } from "./config";
import {
  decryptKugouDeviceData,
  encryptKugouDeviceData,
  getDeviceMid,
  rsaEncryptKugouPkcs1,
  signatureAndroidParams,
} from "./crypto";
import { getSessionCookies, saveSessionCookies } from "@main/database/sessions";

let registering: Promise<string> | null = null;

const registerDevice = async (): Promise<string> => {
  const session = getSessionCookies("kugou");
  const guid = session.guid || randomUUID();
  const encrypted = encryptKugouDeviceData({
    availableRamSize: 4983533568,
    availableRomSize: 48114719,
    availableSDSize: 48114717,
    basebandVer: "",
    batteryLevel: 100,
    batteryStatus: 3,
    brand: "Redmi",
    buildSerial: "unknown",
    device: "marble",
    imei: guid,
    imsi: "",
    manufacturer: "Xiaomi",
    uuid: guid,
    accelerometer: false,
    accelerometerValue: "",
    gravity: false,
    gravityValue: "",
    gyroscope: false,
    gyroscopeValue: "",
    light: false,
    lightValue: "",
    magnetic: false,
    magneticValue: "",
    orientation: false,
    orientationValue: "",
    pressure: false,
    pressureValue: "",
    step_counter: false,
    step_counterValue: "",
    temperature: false,
    temperatureValue: "",
  });
  const clienttime = Math.floor(Date.now() / 1000);
  const params: Record<string, unknown> = {
    dfid: "-",
    mid: getDeviceMid(),
    uuid: "-",
    appid: getKgAppid(),
    clientver: getKgClientver(),
    clienttime,
    part: 1,
    platid: 1,
    p: rsaEncryptKugouPkcs1({
      aes: encrypted.key,
      uid: Number(session.userid || 0),
      token: session.token || "",
    }),
  };
  params.signature = signatureAndroidParams(params, encrypted.content);
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`https://userservice.kugou.com/risk/v2/r_register_dev?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
      dfid: "-",
      mid: getDeviceMid(),
      clienttime: String(clienttime),
    },
    body: encrypted.content,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`KG register device HTTP ${response.status}`);
  const result = decryptKugouDeviceData(
    Buffer.from(await response.arrayBuffer()),
    encrypted.key,
  ) as {
    status?: number;
    data?: { dfid?: string };
  };
  const dfid = result.data?.dfid;
  if (result.status !== 1 || !dfid) throw new Error("KG register device failed");
  saveSessionCookies("kugou", { ...session, guid, dfid });
  return dfid;
};

export const ensureKugouDfid = async (): Promise<string> => {
  const current = getSessionCookies("kugou").dfid;
  if (current) return current;
  registering ??= registerDevice().finally(() => {
    registering = null;
  });
  return await registering;
};
