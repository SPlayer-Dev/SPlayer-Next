import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { defaultWindowStates } from "@shared/defaults/windowStates";
import type { WindowStates } from "@shared/types/windowState";
import { deepMerge } from "./utils";

const filePath = path.join(app.getPath("userData"), "window-states.json");

const readFile = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
};

const flush = (states: WindowStates): void => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(filePath, JSON.stringify(states, null, 2));
  } catch {}
};

let data: WindowStates = deepMerge(defaultWindowStates, readFile());

export const windowStateStore = {
  get<K extends keyof WindowStates>(key: K): WindowStates[K] {
    return data[key];
  },
  set<K extends keyof WindowStates>(key: K, value: WindowStates[K]): void {
    data[key] = value;
    flush(data);
  },
};
