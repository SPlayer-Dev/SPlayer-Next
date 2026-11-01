/** 用户选择的歌曲过渡模式 */
export type TransitionMode = "none" | "crossfade" | "automix";

/** 用户分别管理的分析模型和运行时 */
export type AutoMixComponentId = "beat" | "demucs" | "runtime";

/** 单个可下载组件的紧凑状态 */
export interface AutoMixModelStatus {
  id: AutoMixComponentId;
  state: "missing" | "downloading" | "ready" | "error" | "unsupported";
  received: number;
  total: number;
  error?: string;
  bytesPerSecond?: number;
}

/** 手动下载的 AutoMix 分析组件状态 */
export interface AutoMixComponentStatus {
  state: "missing" | "downloading" | "ready" | "error";
  models: AutoMixModelStatus[];
}

/** 临时分离音频，只在主进程和原生解码器之间传递路径 */
export interface AutoMixStemWindow {
  path: string;
  startMs: number;
  frames: number;
}

/** 首尾窗口的节拍证据，时间均为音源绝对毫秒 */
export interface AutoMixProfile {
  startMs: number;
  endMs: number;
  downbeats: number[];
  periodMs: number | null;
  stability: number;
  /** 可验证的局部匀速区间，不向残响或不规则前奏外推网格 */
  gridStartMs: number | null;
  gridEndMs: number | null;
  firstAudibleMs: number;
  lastAudibleMs: number;
  /** 相对窗口主体电平测得的边界，避免把微弱残响当作仍在演奏 */
  bodyEndMs: number;
  /** 最多四十秒、每一百毫秒一个 RMS 电平，仅用于当前有限窗口 */
  levels: number[];
  /** 与电平同一时间轴的十二维音级能量，不推断整首曲目的调性 */
  chroma: number[];
  /** 根据局部音色和能量变化测得的候选段落边界 */
  boundaries: number[];
}

/** 相对混音起点的音量交接区间，当前曲由一降至零，下一曲由零升至一 */
export interface AutoMixEnvelope {
  startMs: number;
  endMs: number;
}

/** 主进程提交给原生引擎的有限混音计划 */
export interface AutoMixPlan {
  outStartMs: number;
  inStartMs: number;
  durationMs: number;
  outgoingRate: number;
  /** 两个实际重叠窗口的电平比，在交接两端恢复原始增益 */
  levelRatio: number;
  /** 顺序为当前曲与下一曲各自的鼓、贝斯、人声、伴奏，均在音频回调按帧执行 */
  envelopes: AutoMixEnvelope[];
  /** 对拍乐句、短旋律交接或鼓不重叠的原速桥接 */
  strategy: "phrase" | "handoff" | "bridge";
  stems: { outgoing: AutoMixStemWindow; incoming: AutoMixStemWindow };
}

/** 分轨窗口绑定前的声部编排 */
export type AutoMixArrangement = Omit<AutoMixPlan, "stems">;

/** 随预载提交的 AutoMix 范围，不包含服务器凭据 */
export interface AutoMixPrepareOptions {
  mode: TransitionMode;
  endMs?: number;
}

/** 分析组件管理接口，不会在查询状态时自动下载 */
export interface AutoMixApi {
  /**
   * 查询组件文件的安装状态
   * @returns 模型和运行时的安装状态
   */
  getStatus(): Promise<AutoMixComponentStatus>;
  /**
   * 下载固定版本的模型与运行时
   * @param id - 组件标识
   * @returns 安装完成后的组件状态
   */
  download(id: AutoMixComponentId): Promise<AutoMixComponentStatus>;
  /** 取消当前下载 */
  cancelDownload(): Promise<void>;
  /** 订阅状态，返回解绑函数 */
  onStatus(callback: (status: AutoMixComponentStatus) => void): () => void;
}
