# Context Map

本仓库采用 multi-context 领域文档布局。本文件只索引**领域词汇已经确认**的上下文；其余目录在其术语真正得到确认前不建 `CONTEXT.md`。

## 上下文

- [UI Test Harness](./packages/ui-test-harness/CONTEXT.md) — 外置验收控制层的词汇：被测对象、观察窗、常驻测试环境、预检、环境就绪检查、真实验收与诊断。

## 与既有术语表的分工

`docs/glossary.md` 保存**跨上下文**的术语：`Authority`、`Evidence`、`Observer`、`Sidecar 事件`、`薄适配代码`、`Windows 必需 CI`。各 `CONTEXT.md` 不重复定义这些词，只使用它们。新增术语前先判断它属于跨上下文还是单一上下文，避免两处定义漂移。

## 关系

- **UI Test Harness → Authority**：Harness 的通过判定只采信 Authority 提供的 Task、Run 与 RunEvent，不解析模型自然语言，也不把被测对象的屏幕文本当作事实。
- **UI Test Harness → 被测对象**：CodeArts TUI 与 OpenChamber GUI 保持上游原版，Harness 只从外部驱动与观察，不为容纳测试而改造二者。
- **UI Test Harness → Evidence**：同一次运行的 VT、输入、权威快照、浏览器诊断与诊断结论共享同一组 `sessionId`/`taskId`/`runId`，构成可复核链。

## 尚未建立上下文的目录

`packages/mcp-server`、`packages/run-relay`、`packages/contracts`、`integrations/` 等尚未经过 domain-modeling 确认词汇，暂不建 `CONTEXT.md`。需要时再补充，并在本文件登记。
