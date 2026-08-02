<!--
感谢贡献！提交前请确认：
1. 单个 PR 尽量只聚焦一个主要功能或修复，便于审查与回滚；多个不相关的改动请拆成多个 PR。
2. 请向 dev 分支提交。
3. 若改动中包含 AI 生成的代码，请务必自行完整测试与审阅，对其正确性负责，不要未经验证直接提交。
-->

## 改动类型

- [x] 新功能（feat）
- [x] 缺陷修复（fix）
- [ ] 重构 / 优化（不改变对外行为）
- [ ] 文档（docs）
- [ ] 其他（请在「改动说明」中注明）

## 是否包含破坏性变更

- [ ] 是（请在「改动说明」中详细描述）
- [x] 否

## 改动说明

本次 PR 为 TTML（Apple Music）歌词解析器添加 ruby 注音支持，并修复 `normalizeRubyElements` 函数的死循环 bug。

**主要变更：**

1. **新增 `normalizeRubyElements` 函数**：预处理 TTML 中的 `tts:ruby` 元素，统一转换为带时间戳的 `<span>` 结构，支持两种格式：
   - 标准 TTML：`<tts:ruby base="行"><tts:ruby:textContainer><tts:ruby:text>い</tts:ruby:text></tts:ruby:textContainer></tts:ruby>`
   - 简化格式：`<span tts:ruby="container"><span tts:ruby="base">行</span><span tts:ruby="textContainer">...</span></span>`

2. **修复死循环 bug**：原实现中 `queue.push(child)` 后若 `parentElement` 为 null 则 `continue`，但 child 仍在 `current.children[0]`，导致内层循环无限重复。修复方案改为先收集子元素快照再遍历，并对已展开的 ruby 元素不再加入队列。

3. **时间戳优先级优化**：当 span 包含 ruby base 子元素时，优先使用 base 的时间戳（来自 `ttml:text`），而非外层 span 的时间戳。

4. **新增测试用例**：覆盖标准格式和简化格式的 ruby 注音解析。

## 关联 Issue

<!-- 如有关联，填 #编号；写 "Closes #编号" 可在合并时自动关闭对应 Issue -->

## 测试情况

- 运行 `pnpm test src/utils/lyric/parse.spec.ts`，9 个测试全部通过
- 测试覆盖：
  - 标准 TTML ruby 格式（`<tts:ruby base="...">`）
  - 简化 TTML ruby 格式（`<span tts:ruby="container">`）
  - 时间戳优先级验证（base 时间戳优先于外层 span）
  - 空字符串单词过滤

## 截图 / 录屏

<!-- 涉及 UI 改动请附上；无则可删除本节 -->

## 自查清单

- [x] 本 PR 只包含**一个主要功能 / 修复**，没有夹带无关改动
- [x] 已在本地**完整测试**通过；**AI 生成的代码同样自行测试并审阅过**，未做未经验证的提交
- [x] 已运行 `pnpm format`，并确认 `pnpm typecheck`、`pnpm lint` 通过
- [x] 改动涉及原生模块时已 `pnpm build:native` 验证；未手写 `native/*/index.d.ts`
- [x] 已向 `dev` 分支提交
