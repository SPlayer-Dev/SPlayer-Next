---
applyTo: "**"
---

# 审查指引

所有审查评论、建议、总结一律**用中文**输出。

## 审查关注点

**真实问题优先，风格偏好最后**。优先揪出：

- 运行时 bug、竞态、内存 / 资源泄漏（IPC 监听器、RAF、ResizeObserver、Windows 事件钩子未清理）
- 类型与实现不一致（如 preload API 类型声明与实际 resolve 值不匹配）
- 主进程资源生命周期：窗口 `closed` 事件之外的重复清理会引发双 `stop()` / 双 broadcast
- 硬编码值掩盖用户设置：检查配置项是否真的生效到底层模块
- 原生模块 COM 生命周期（`CoInitializeEx` 的返回值必须判断，`CoUninitialize` 只在真正初始化成功时调用；参考 `native/taskbar-lyric/src/uia.rs` 的 `should_uninitialize` 模式）
- 锁的持有时长：回调执行前应先 clone `Arc` 放开 `Mutex`，避免阻塞其它访问与重入死锁
- 渲染端持久化：`TrackDetail` / 大歌词字符串不应进 sessionStorage
- 不同进程对 `@shared/*` 类型的使用是否一致

## 避免的建议

- 不要建议改 Prettier 风格（双引号 / 分号 / 100 列 / 末尾逗号已锁定）
- 不要建议手写原生模块类型，必须从 `@splayer/<module>` 导入
- 不要建议在渲染端直接 `import log from "electron-log"` 或在主进程绕过 `@main/utils/logger`
- 不要建议为"防御性编程"添加内部代码的运行时校验（只在系统边界校验）
- 不要建议拆分三行的类似代码为抽象，除非有三个以上真实用例

## 评论风格

- 直接指出问题所在文件 / 行号 / 变量名，配可执行的修法
- 区分「必修」「建议」「风格」，便于作者决定优先级
- 若和项目现有模式有冲突，**先查 `CLAUDE.md` 和 `.github/copilot-instructions.md`** 确认约定再提
