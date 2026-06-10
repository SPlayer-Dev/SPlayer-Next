/**
 * 通过 dot path 取嵌套值
 * @param obj - 对象
 * @param dotPath - 形如 "player.equalizer.bands"
 * @returns 值；中间节点缺失返回 undefined
 */
export const getByPath = (obj: unknown, dotPath: string): unknown => {
  const keys = dotPath.split(".");
  let cur = obj as Record<string, unknown> | null | undefined;
  for (const key of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key] as Record<string, unknown> | null | undefined;
  }
  return cur;
};

/**
 * 通过 dot path 写入嵌套值，缺失的中间对象会自动补齐
 * @param obj - 目标对象
 * @param dotPath - 形如 "player.equalizer.bands"
 * @param value - 新值
 */
export const setByPath = (obj: unknown, dotPath: string, value: unknown): void => {
  const keys = dotPath.split(".");
  // 拒绝原型链键，防止 "a.__proto__.x" 形式的路径污染 Object.prototype
  if (keys.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    return;
  }
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
};
