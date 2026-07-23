# ADR-0003：OpenCode 优先的观察与可视化测试栈

状态：接受
日期：2026-07-23

## 背景

GameForge 需要观察真实 CodeArts TUI、OpenCode 会话和 OpenChamber 浏览器，同时保存 VT、MCP Audit、Relay Authority 和关键截图。此前 Relay 与部分观察逻辑为自研，存在重复建设通用事件基础设施的风险。

## 决策

新增能力按以下优先级选型：

`OpenCode 官方库/协议 > 成熟第三方库 > 最薄适配代码 > 自研基础设施`

OpenCode 的 `Session`、`Message`、`Part`、事件 ID、SSE 和 SDK 作为 Agent 观察层的首选来源。GameForge 的 Task/Run Authority、浏览器验收、截图和证据索引保留为独立 sidecar，不强行伪装成 OpenCode Part。

第一阶段先实现只读 OpenCode Observer 探针：订阅官方事件流、保存原始事件、验证游标/顺序/重连，并在真实 CodeArts 上探测而不是推断其兼容性。浏览器使用 Playwright，终端观察评估 xterm.js，通用队列与持久化在需要扩展时优先评估第三方库。

## 取舍

- 保留现有 Relay API，避免把可视化实现和基础设施迁移绑定在一起。
- 允许少量自研代码做事件映射、ID 关联、Evidence manifest 和 GameForge 门禁。
- 不自研通用队列、事件总线、VT 解析、浏览器驱动或持久化框架。
- Codex 风格协议对齐暂不实施；未来以单向适配器实现。

## 验收

1. OpenCode Observer 使用官方 SDK/SSE 或明确记录官方能力不足的原因。
2. 原始 OpenCode 事件保留 `id`、`type`、`properties` 和来源信息。
3. 断线重连、`after` 游标和事件顺序有可执行测试。
4. CodeArts 不兼容时，实验记录明确区分事实、推断和 sidecar 适配。
5. 浏览器关键节点截图、VT、MCP Audit、Relay 事件共享 `sessionId`/`runId`。

## 官方参考

- [OpenCode SDK](https://opencode.ai/docs/sdk/)（访问日期：2026-07-23）
- [OpenCode MessageV2](https://github.com/anomalyco/opencode/blob/411eff73f026d4950c07947c4d983788cb615baa/packages/opencode/src/session/message-v2.ts)（访问日期：2026-07-23）
- [OpenCode Event SSE](https://github.com/anomalyco/opencode/blob/411eff73f026d4950c07947c4d983788cb615baa/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts)（访问日期：2026-07-23）
