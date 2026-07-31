/** AI 模型接口协议 */
export type AiModelProtocol = "openai-compatible" | "anthropic";

/** AI 模型公开配置 */
export interface AiModelConfig {
  /** 本地配置 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 接口协议 */
  protocol: AiModelProtocol;
  /** API 根地址 */
  baseUrl: string;
  /** 服务端模型 ID */
  model: string;
  /** 是否已经保存密钥 */
  hasApiKey: boolean;
}

/** AI 模型配置状态 */
export interface AiModelState {
  models: AiModelConfig[];
  activeModelId: string | null;
}

/** 新增或更新 AI 模型的输入 */
export interface AiModelSaveInput {
  id?: string;
  name: string;
  protocol: AiModelProtocol;
  baseUrl: string;
  model: string;
  /** 编辑时留空则保留已经保存的密钥 */
  apiKey?: string;
}

/** AI 模型 IPC 接口 */
export interface AiModelApi {
  list: () => Promise<AiModelState>;
  save: (input: AiModelSaveInput) => Promise<AiModelState>;
  remove: (id: string) => Promise<AiModelState>;
  setActive: (id: string | null) => Promise<AiModelState>;
}
