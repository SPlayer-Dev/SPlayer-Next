/** QS 模块入参 */
export type QSParams = Record<string, unknown>;

/** QS 模块统一签名 */
export type QSModule = (params: QSParams) => Promise<any>;
