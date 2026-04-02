import type { SystemConfig } from "@shared/types/settings";

/** 生成 dot path 联合类型 */
export type DotPath<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? T[K] extends unknown[]
          ? `${Prefix}${K}`
          : `${Prefix}${K}` | DotPath<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

/** 根据 dot path 推断值类型 */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export type ConfigPath = DotPath<SystemConfig>;
