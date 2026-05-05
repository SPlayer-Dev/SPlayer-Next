/**
 * Electron Accelerator 字符串解析、规范化、匹配、显示工具
 * 在解析/匹配/显示时按平台展开 CommandOrControl
 */

/** 解析后的加速键结构 */
export interface ParsedAccelerator {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** event.code 形式的物理键码（如 "KeyA"、"Space"、"ArrowLeft"） */
  code: string;
}

/** Modifier token 集合（不区分大小写） */
const MODIFIER_TOKENS = new Set([
  "ctrl",
  "control",
  "cmd",
  "command",
  "meta",
  "super",
  "alt",
  "option",
  "shift",
  "commandorcontrol",
  "cmdorctrl",
]);

/**
 * 把 Accelerator 中的 key token（最后一段非 modifier）规范成 KeyboardEvent.code 形式
 * Electron Accelerator 用的是 key 字符（如 "A"、"Right"），需要映射到 code
 */
const keyToCode = (token: string): string => {
  const t = token.trim();
  if (!t) return "";
  // 字母
  if (/^[A-Za-z]$/.test(t)) return `Key${t.toUpperCase()}`;
  // 数字
  if (/^[0-9]$/.test(t)) return `Digit${t}`;
  // 方向键
  const arrow: Record<string, string> = {
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
  };
  const lower = t.toLowerCase();
  if (lower in arrow) return arrow[lower];
  // 功能键 F1-F24
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(t)) return `F${t.slice(1)}`;
  // 常见键
  const map: Record<string, string> = {
    space: "Space",
    spacebar: "Space",
    enter: "Enter",
    return: "Enter",
    esc: "Escape",
    escape: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    tab: "Tab",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    insert: "Insert",
    plus: "Equal",
    "=": "Equal",
    "-": "Minus",
    minus: "Minus",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "`": "Backquote",
  };
  if (lower in map) return map[lower];
  // 兜底：原样返回
  return t;
};

/**
 * 解析 Accelerator 字符串
 * @param accel 加速键字符串，如 "CommandOrControl+Shift+R"
 * @param isMac 当前平台是否为 macOS（用于展开 CommandOrControl）
 */
export const parseAccelerator = (accel: string, isMac: boolean): ParsedAccelerator | null => {
  if (!accel) return null;
  const tokens = accel
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const result: ParsedAccelerator = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    code: "",
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (MODIFIER_TOKENS.has(lower)) {
      switch (lower) {
        case "ctrl":
        case "control":
          result.ctrl = true;
          break;
        case "cmd":
        case "command":
        case "meta":
        case "super":
          result.meta = true;
          break;
        case "alt":
        case "option":
          result.alt = true;
          break;
        case "shift":
          result.shift = true;
          break;
        case "commandorcontrol":
        case "cmdorctrl":
          if (isMac) result.meta = true;
          else result.ctrl = true;
          break;
      }
    } else {
      // 非 modifier 视为最终键（理论上只应有一个）
      result.code = keyToCode(token);
    }
  }

  if (!result.code) return null;
  return result;
};

/**
 * 规范化 Accelerator：固定 modifier 顺序、统一大小写
 * 顺序：CommandOrControl > Cmd > Ctrl > Alt > Shift > Key
 */
export const normalizeAccelerator = (accel: string): string => {
  if (!accel) return "";
  const tokens = accel
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  const mods = { cmdOrCtrl: false, cmd: false, ctrl: false, alt: false, shift: false };
  let key = "";
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === "commandorcontrol" || lower === "cmdorctrl") mods.cmdOrCtrl = true;
    else if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "super")
      mods.cmd = true;
    else if (lower === "ctrl" || lower === "control") mods.ctrl = true;
    else if (lower === "alt" || lower === "option") mods.alt = true;
    else if (lower === "shift") mods.shift = true;
    else key = t;
  }
  if (!key) return "";
  // 字母统一大写
  if (/^[a-z]$/.test(key)) key = key.toUpperCase();
  const parts: string[] = [];
  if (mods.cmdOrCtrl) parts.push("CommandOrControl");
  if (mods.cmd) parts.push("Cmd");
  if (mods.ctrl) parts.push("Ctrl");
  if (mods.alt) parts.push("Alt");
  if (mods.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
};

/** 直接对已解析结构与事件比较，避免热路径重复解析字符串 */
export const matchParsed = (event: KeyboardEvent, parsed: ParsedAccelerator): boolean => {
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.metaKey !== parsed.meta) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.shiftKey !== parsed.shift) return false;
  return event.code === parsed.code;
};

/**
 * 把 KeyboardEvent 与 Accelerator 比较
 * @param event 浏览器键盘事件
 * @param accel 加速键字符串
 * @param isMac 当前平台是否 macOS
 */
export const matchEvent = (event: KeyboardEvent, accel: string, isMac: boolean): boolean => {
  const parsed = parseAccelerator(accel, isMac);
  if (!parsed) return false;
  return matchParsed(event, parsed);
};

/**
 * 把 Accelerator 渲染为人类可读字符串
 * @param accel Accelerator 字符串
 * @param isMac 当前平台是否 macOS（决定符号样式）
 */
export const formatAccelerator = (accel: string | null, isMac: boolean): string => {
  if (!accel) return "";
  const tokens = accel
    .split("+")
    .map((t) => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === "commandorcontrol" || lower === "cmdorctrl") {
      out.push(isMac ? "⌘" : "Ctrl");
    } else if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "super") {
      out.push(isMac ? "⌘" : "Win");
    } else if (lower === "ctrl" || lower === "control") {
      out.push(isMac ? "⌃" : "Ctrl");
    } else if (lower === "alt" || lower === "option") {
      out.push(isMac ? "⌥" : "Alt");
    } else if (lower === "shift") {
      out.push(isMac ? "⇧" : "Shift");
    } else if (lower === "left" || lower === "right" || lower === "up" || lower === "down") {
      const arrow: Record<string, string> = { left: "←", right: "→", up: "↑", down: "↓" };
      out.push(arrow[lower]);
    } else if (lower === "enter" || lower === "return") {
      out.push(isMac ? "↵" : "Enter");
    } else if (lower === "space" || lower === "spacebar") {
      out.push("Space");
    } else if (/^[a-z]$/.test(lower)) {
      out.push(lower.toUpperCase());
    } else {
      out.push(t);
    }
  }
  return isMac ? out.join("") : out.join(" + ");
};

/**
 * 从 KeyboardEvent 反推为 Accelerator 字符串
 * @param event 键盘事件
 * @param isMac 平台
 * @returns null 表示当前事件不构成有效组合（如只按了 modifier 单键）
 */
export const eventToAccelerator = (event: KeyboardEvent, isMac: boolean): string | null => {
  // modifier 单按视为未完成
  const isModifierKey =
    event.code === "ControlLeft" ||
    event.code === "ControlRight" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight" ||
    event.code === "AltLeft" ||
    event.code === "AltRight" ||
    event.code === "MetaLeft" ||
    event.code === "MetaRight" ||
    event.code === "OSLeft" ||
    event.code === "OSRight";
  if (isModifierKey) return null;

  // 按 code 反向算 token
  const codeToToken = (code: string): string => {
    if (code.startsWith("Key")) return code.slice(3); // KeyA → A
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Arrow")) return code.slice(5); // ArrowLeft → Left
    if (code.startsWith("F") && /^F[0-9]+$/.test(code)) return code; // F1
    const map: Record<string, string> = {
      Space: "Space",
      Enter: "Return",
      Escape: "Escape",
      Backspace: "Backspace",
      Delete: "Delete",
      Tab: "Tab",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Insert: "Insert",
      Equal: "=",
      Minus: "-",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Backquote: "`",
    };
    return map[code] ?? code;
  };

  const parts: string[] = [];
  // mac 上 metaKey=Cmd 视作 CommandOrControl，非 mac 上 ctrlKey=Ctrl 视作 CommandOrControl；
  // 另一个 cmd-like 键（mac 的 Ctrl / 非 mac 的 Win）独立保留，避免共按时丢 modifier
  const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
  const otherCmdLike = isMac ? event.ctrlKey : event.metaKey;
  if (cmdOrCtrl) parts.push("CommandOrControl");
  if (otherCmdLike) parts.push(isMac ? "Ctrl" : "Cmd");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(codeToToken(event.code));
  return normalizeAccelerator(parts.join("+"));
};
