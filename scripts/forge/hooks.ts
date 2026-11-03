/** 运行时从 node_modules 加载的原生依赖，主进程构建时设为外部依赖，打包时由钩子复制 */
export const NATIVE_DEPENDENCIES = ["better-sqlite3", "font-list"] as const;
