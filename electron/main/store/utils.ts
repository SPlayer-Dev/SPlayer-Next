/**
 * 创建无原型对象，防止 JSON 原型污染
 * @returns 无原型对象
 */
export const createPlainObject = (): Record<string, unknown> =>
  Object.create(null) as Record<string, unknown>;

/**
 * 深度合并
 * defaults 为基底，stored 覆盖已有值，缺失字段从 defaults 补全
 * @param defaults 基底对象
 * @param stored 存储对象
 * @returns 合并后的对象
 */
export const deepMerge = <T>(defaults: T, stored: unknown): T => {
  if (
    typeof defaults !== "object" ||
    defaults === null ||
    typeof stored !== "object" ||
    stored === null ||
    Array.isArray(defaults)
  ) {
    return (stored ?? defaults) as T;
  }
  const result = Object.assign(createPlainObject(), defaults) as Record<string, unknown>;
  const src = stored as Record<string, unknown>;
  for (const key of Object.keys(defaults as Record<string, unknown>)) {
    result[key] = deepMerge((defaults as Record<string, unknown>)[key], src[key]);
  }
  for (const key of Object.keys(src)) {
    if (!(key in result)) result[key] = src[key];
  }
  return result as T;
};

/**
 * 通过 dot path 取值
 * @param obj 对象
 * @param dotPath 点号路径
 * @returns 值
 */
export const getByPath = (obj: unknown, dotPath: string): unknown => {
  const keys = dotPath.split(".");
  let cur = obj as Record<string, unknown>;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k] as Record<string, unknown>;
  }
  return cur;
};

/**
 * 通过 dot path 赋值
 * @param obj 对象
 * @param dotPath 点号路径
 * @param value 值
 */
export const setByPath = (obj: unknown, dotPath: string, value: unknown): void => {
  const keys = dotPath.split(".");
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
};
