/** 系统安全存储后端 */
export type SecretStorageBackend =
  | "dpapi"
  | "keychain"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "basic_text"
  | "unknown";

/** 系统安全存储能力 */
export interface SecretStorageStatus {
  /** 异步加解密是否可用 */
  available: boolean;
  /** 是否仅具备 basic_text 混淆能力 */
  weak: boolean;
  /** 当前系统后端 */
  backend: SecretStorageBackend;
}
