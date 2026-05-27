import type { Component } from "vue";

export type ToastType = "default" | "info" | "success" | "warning" | "error" | "loading";

export interface ToastOptions {
  /** 持续时长（毫秒），0 表示不自动关闭，默认 3000 */
  duration?: number;
  /** 是否显示关闭按钮，默认 false */
  closable?: boolean;
  /** 自定义图标组件，传 false 隐藏图标 */
  icon?: Component | false;
}

export interface ToastInstance {
  /** toast ID */
  id: number;
  /** 关闭此 toast */
  close: () => void;
}

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  closable: boolean;
  icon: Component | false | undefined;
}

/** 最大同时显示数量，由组件注册时设置 */
let maxToasts = 5;

/** 全局 toast 队列 */
const toasts = shallowReactive<ToastItem[]>([]);

/** 定时器映射 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** 下一个 toast ID */
let nextId = 0;

/** 移除指定 id 的 toast */
const remove = (id: number): void => {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) toasts.splice(idx, 1);
};

/**
 * 添加 toast
 * @param type toast 类型
 * @param message toast 消息
 * @param options toast 选项
 * @returns toast 实例
 */
const push = (type: ToastType, message: string, options?: ToastOptions): ToastInstance => {
  const { duration = 3000, closable = false, icon } = options ?? {};
  while (toasts.length >= maxToasts) {
    remove(toasts[0].id);
  }
  const id = nextId++;
  toasts.push({ id, type, message, closable, icon });
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => remove(id), duration),
    );
  }
  return { id, close: () => remove(id) };
};

/** 全局 toast API */
export const toast = {
  show: (message: string, options?: ToastOptions) => push("default", message, options),
  info: (message: string, options?: ToastOptions) => push("info", message, options),
  success: (message: string, options?: ToastOptions) => push("success", message, options),
  warning: (message: string, options?: ToastOptions) => push("warning", message, options),
  error: (message: string, options?: ToastOptions) => push("error", message, options),
  loading: (message: string, options?: ToastOptions) => push("loading", message, options),
  remove,
};

/** 设置最大显示数量 */
export const setMaxToasts = (max: number): void => {
  maxToasts = max;
};

/** 获取队列引用 */
export const useToast = () => ({ toasts, ...toast });
